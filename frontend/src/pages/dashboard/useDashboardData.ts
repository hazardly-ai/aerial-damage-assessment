import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ApiError,
	type BuildingFeature,
	type BuildingStatsResponse,
	fetchBuildingStatsForDisaster,
	fetchBuildingsForDisaster,
	fetchDisasters,
	fetchImagePairs,
	type ImagePairFeature,
} from "@/utils/hazardlyApi";
import type {
	ActiveSection,
	BuildingCorrectnessFilter,
	BuildingListItem,
	ImagePairRow,
	ImagePairSortKey,
	PredictionMetrics,
	SortDirection,
} from "./dashboardTypes";
import {
	buildImagePairRows,
	buildOverviewDamageRows,
	buildStatsFromFeatures,
	CONFUSION_LABELS,
	createEmptyConfusionMatrix,
	normalizeDamage,
	PAGE_SIZE,
} from "./dashboardUtils";

const compareImagePairRows = (
	left: ImagePairRow,
	right: ImagePairRow,
	key: ImagePairSortKey,
	direction: SortDirection,
) => {
	const multiplier = direction === "asc" ? 1 : -1;
	const leftValue =
		key === "accuracyPct"
			? left.accuracyPct == null
				? -1
				: Number(left.accuracyPct)
			: left[key];
	const rightValue =
		key === "accuracyPct"
			? right.accuracyPct == null
				? -1
				: Number(right.accuracyPct)
			: right[key];

	if (leftValue < rightValue) return -1 * multiplier;
	if (leftValue > rightValue) return 1 * multiplier;
	return left.xbd_id - right.xbd_id;
};

const matchesWildcard = (value: string, pattern: string) => {
	if (!pattern.includes("*")) {
		return value === pattern;
	}

	const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	const regexPattern = `^${escapedPattern.split("*").join(".*")}$`;
	return new RegExp(regexPattern).test(value);
};

type ImagePairLookup = Map<
	number,
	{
		xbd_id: number;
		pre_image_path?: string | null;
		post_image_path?: string | null;
	}
>;

export function useDashboardData() {
	const [loadingStats, setLoadingStats] = useState(true);
	const [loadingBuildings, setLoadingBuildings] = useState(false);
	const [loadingImagePairs, setLoadingImagePairs] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeSection, setActiveSection] = useState<ActiveSection>("overview");
	const [activeDamageFilter, setActiveDamageFilter] = useState<string>("all");
	const [buildingSearchQuery, setBuildingSearchQuery] = useState("");
	const [disasterSearchQuery, setDisasterSearchQuery] = useState("");
	const [xbdSearchQuery, setXbdSearchQuery] = useState("");
	const [predictedDamageFilter, setPredictedDamageFilter] =
		useState<string>("all");
	const [buildingCorrectnessFilter, setBuildingCorrectnessFilter] =
		useState<BuildingCorrectnessFilter>("all");
	const [selectedDisasterId, setSelectedDisasterId] = useState<number | null>(
		null,
	);
	const [selectedDisasterName, setSelectedDisasterName] = useState<
		string | null
	>(null);
	const [allBuildingsCache, setAllBuildingsCache] = useState<
		BuildingFeature[] | null
	>(null);
	const [imagePairMap, setImagePairMap] = useState<ImagePairLookup>(new Map());
	const [stats, setStats] = useState<BuildingStatsResponse>({
		total: 0,
		no_damage: 0,
		by_damage: {},
	});
	const [rows, setRows] = useState<BuildingListItem[]>([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [totalItems, setTotalItems] = useState(0);
	const [imagePairsPage, setImagePairsPage] = useState(1);
	const [imagePairSortKey, setImagePairSortKey] =
		useState<ImagePairSortKey | null>(null);
	const [imagePairSortDirection, setImagePairSortDirection] =
		useState<SortDirection | null>(null);
	const imagePairMapRef = useRef(imagePairMap);
	const allBuildingsCacheRef = useRef(allBuildingsCache);
	const hasLoadedInitialStatsRef = useRef(false);

	imagePairMapRef.current = imagePairMap;
	allBuildingsCacheRef.current = allBuildingsCache;

	const ensureImagePairs = useCallback(async (disasterId: number) => {
		if (imagePairMapRef.current.size > 0) return imagePairMapRef.current;
		const data = await fetchImagePairs(disasterId);
		const next: ImagePairLookup = new Map();

		for (const feature of data.features ?? []) {
			const props = feature.properties as ImagePairFeature["properties"] & {
				id?: number;
			};
			if (typeof props.id !== "number") continue;
			next.set(props.id, {
				xbd_id: feature.properties.xbd_id,
				pre_image_path: feature.properties.pre_image_path ?? null,
				post_image_path: feature.properties.post_image_path ?? null,
			});
		}

		imagePairMapRef.current = next;
		setImagePairMap(next);
		return next;
	}, []);

	const ensureAllBuildings = useCallback(async (disasterId: number) => {
		if (allBuildingsCacheRef.current) return allBuildingsCacheRef.current;
		const data = await fetchBuildingsForDisaster(disasterId);
		const features = data.features ?? [];
		allBuildingsCacheRef.current = features;
		setAllBuildingsCache(features);
		return features;
	}, []);

	useEffect(() => {
		if (hasLoadedInitialStatsRef.current) return;
		hasLoadedInitialStatsRef.current = true;

		const loadStats = async () => {
			try {
				setLoadingStats(true);
				setError(null);

				const disasters = await fetchDisasters();
				if (disasters.length === 0) {
					setError("No disasters available.");
					setLoadingStats(false);
					return;
				}

				const currentDisaster = disasters[0];
				setSelectedDisasterId(currentDisaster.id);
				setSelectedDisasterName(currentDisaster.name);

				const [allBuildingsResult, statsResult] = await Promise.allSettled([
					ensureAllBuildings(currentDisaster.id),
					(async () => {
						try {
							const nextStats = await fetchBuildingStatsForDisaster(
								currentDisaster.id,
							);
							setStats(nextStats);
						} catch (err) {
							if (err instanceof ApiError && err.status === 404) {
								const features = await ensureAllBuildings(currentDisaster.id);
								setStats(buildStatsFromFeatures(features));
								return;
							}
							throw err;
						}
					})(),
				]);

				if (allBuildingsResult.status === "rejected") {
					setError(
						allBuildingsResult.reason instanceof Error
							? allBuildingsResult.reason.message
							: "Unexpected dashboard error.",
					);
					return;
				}

				if (statsResult.status === "rejected") {
					setError(
						statsResult.reason instanceof Error
							? statsResult.reason.message
							: "Unexpected dashboard error.",
					);
				}
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Unexpected dashboard error.",
				);
			} finally {
				setLoadingStats(false);
			}
		};

		void loadStats();
	}, [ensureAllBuildings]);

	const predictionMetrics = useMemo<PredictionMetrics>(() => {
		const confusionMatrix = createEmptyConfusionMatrix();

		if (!allBuildingsCache) {
			return {
				correctCount: 0,
				comparedCount: 0,
				accuracyPct: "0.0",
				confusionMatrix,
				available: false,
				matrixTotal: 0,
				matrixMax: 0,
			};
		}

		let correctCount = 0;
		let comparedCount = 0;

		for (const feature of allBuildingsCache) {
			const actual = normalizeDamage(feature.properties.actual_damage);
			const rawPredicted = feature.properties.predicted_damage;
			if (rawPredicted == null) continue;

			const predicted = normalizeDamage(rawPredicted);
			if (actual === "un-classified" || predicted === "un-classified") continue;
			comparedCount += 1;
			if (actual === predicted) correctCount += 1;

			confusionMatrix[actual][predicted] += 1;
		}

		let matrixMax = 0;
		for (const actualLabel of CONFUSION_LABELS) {
			for (const predictedLabel of CONFUSION_LABELS) {
				const value = confusionMatrix[actualLabel][predictedLabel];
				if (value > matrixMax) matrixMax = value;
			}
		}

		return {
			correctCount,
			comparedCount,
			accuracyPct:
				comparedCount > 0
					? ((correctCount / comparedCount) * 100).toFixed(1)
					: "0.0",
			confusionMatrix,
			available: comparedCount > 0,
			matrixTotal: comparedCount,
			matrixMax,
		};
	}, [allBuildingsCache]);

	useEffect(() => {
		if (activeSection !== "buildings") return;
		if (selectedDisasterId == null) return;

		const loadBuildingsPage = async () => {
			try {
				setLoadingBuildings(true);
				setError(null);

				const pairs = await ensureImagePairs(selectedDisasterId);
				const features = await ensureAllBuildings(selectedDisasterId);

				const normalizedBuildingQuery = buildingSearchQuery
					.trim()
					.toLowerCase();
				const normalizedDisasterQuery = disasterSearchQuery
					.trim()
					.toLowerCase();
				const normalizedXbdQuery = xbdSearchQuery.trim();

				const mappedAll: BuildingListItem[] = features.map((feature) => {
					const prop = feature.properties;
					const pair = pairs.get(prop.image_pair_id);
					const actual = normalizeDamage(prop.actual_damage);
					const predicted =
						prop.predicted_damage == null
							? null
							: normalizeDamage(prop.predicted_damage);

					return {
						id: prop.id,
						uid: prop.uid,
						address: typeof prop.address === "string" ? prop.address : null,
						disaster_name: selectedDisasterName ?? "Unknown",
						image_pair_id: prop.image_pair_id,
						xbd_id: pair?.xbd_id ?? -1,
						actual_damage: actual,
						predicted_damage: predicted,
						is_correct: predicted === null ? null : actual === predicted,
						created_at: prop.created_at ?? null,
						pre_image_path: pair?.pre_image_path ?? null,
						post_image_path: pair?.post_image_path ?? null,
					};
				});

				const filtered = mappedAll.filter((building) => {
					if (
						activeDamageFilter !== "all" &&
						normalizeDamage(building.actual_damage) !== activeDamageFilter
					) {
						return false;
					}

					if (predictedDamageFilter !== "all") {
						if (predictedDamageFilter === "missing") {
							if (building.predicted_damage !== null) return false;
						} else if (building.predicted_damage !== predictedDamageFilter) {
							return false;
						}
					}

					if (buildingCorrectnessFilter !== "all") {
						if (
							buildingCorrectnessFilter === "yes" &&
							building.is_correct !== true
						) {
							return false;
						}
						if (
							buildingCorrectnessFilter === "no" &&
							building.is_correct !== false
						) {
							return false;
						}
					}

					if (normalizedBuildingQuery) {
						const address = building.address?.toLowerCase() ?? "";
						const uid = building.uid.toLowerCase();
						if (
							!address.includes(normalizedBuildingQuery) &&
							!uid.includes(normalizedBuildingQuery)
						) {
							return false;
						}
					}

					if (
						normalizedDisasterQuery &&
						!building.disaster_name
							.toLowerCase()
							.includes(normalizedDisasterQuery)
					) {
						return false;
					}

					return (
						!normalizedXbdQuery ||
						matchesWildcard(String(building.xbd_id), normalizedXbdQuery)
					);
				});

				const nextTotalItems = filtered.length;
				const nextTotalPages = Math.max(
					1,
					Math.ceil(nextTotalItems / PAGE_SIZE),
				);
				const clampedPage = Math.min(page, nextTotalPages);

				if (clampedPage !== page) {
					setPage(clampedPage);
					return;
				}

				const start = (clampedPage - 1) * PAGE_SIZE;
				const mapped = filtered.slice(start, start + PAGE_SIZE);

				setRows(mapped);
				setTotalItems(nextTotalItems);
				setTotalPages(nextTotalPages);
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: "Unexpected dashboard error while loading buildings.",
				);
				setRows([]);
			} finally {
				setLoadingBuildings(false);
			}
		};

		void loadBuildingsPage();
	}, [
		activeSection,
		selectedDisasterId,
		page,
		activeDamageFilter,
		buildingSearchQuery,
		disasterSearchQuery,
		xbdSearchQuery,
		predictedDamageFilter,
		buildingCorrectnessFilter,
		ensureAllBuildings,
		ensureImagePairs,
		selectedDisasterName,
	]);

	useEffect(() => {
		if (activeSection !== "image-pairs") return;
		if (selectedDisasterId == null) return;

		const loadImagePairs = async () => {
			try {
				setLoadingImagePairs(true);
				setError(null);
				await Promise.all([
					ensureImagePairs(selectedDisasterId),
					ensureAllBuildings(selectedDisasterId),
				]);
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: "Unexpected dashboard error while loading image pairs.",
				);
			} finally {
				setLoadingImagePairs(false);
			}
		};

		void loadImagePairs();
	}, [activeSection, selectedDisasterId, ensureImagePairs, ensureAllBuildings]);

	const overviewDamageRows = useMemo(
		() =>
			buildOverviewDamageRows({
				stats,
				allBuildingsCache,
				confusionMatrix: predictionMetrics.confusionMatrix,
			}),
		[stats, allBuildingsCache, predictionMetrics],
	);

	const imagePairRows = useMemo<ImagePairRow[]>(
		() => buildImagePairRows({ allBuildingsCache, imagePairMap }),
		[allBuildingsCache, imagePairMap],
	);

	const sortedImagePairRows = useMemo<ImagePairRow[]>(() => {
		const rows = [...imagePairRows];
		rows.sort((left, right) => {
			if (imagePairSortKey == null || imagePairSortDirection == null) {
				return compareImagePairRows(left, right, "xbd_id", "asc");
			}

			return compareImagePairRows(
				left,
				right,
				imagePairSortKey,
				imagePairSortDirection,
			);
		});
		return rows;
	}, [imagePairRows, imagePairSortDirection, imagePairSortKey]);

	const imagePairTotalItems = sortedImagePairRows.length;
	const imagePairTotalPages = Math.max(
		1,
		Math.ceil(imagePairTotalItems / PAGE_SIZE),
	);
	const imagePairPageClamped = Math.min(imagePairsPage, imagePairTotalPages);
	const imagePairPageRows = sortedImagePairRows.slice(
		(imagePairPageClamped - 1) * PAGE_SIZE,
		imagePairPageClamped * PAGE_SIZE,
	);

	useEffect(() => {
		if (imagePairsPage !== imagePairPageClamped) {
			setImagePairsPage(imagePairPageClamped);
		}
	}, [imagePairsPage, imagePairPageClamped]);

	const setDamageFilter = useCallback((filter: string) => {
		setActiveDamageFilter(filter);
		setPage(1);
		setActiveSection("buildings");
	}, []);

	const setBuildingsSection = useCallback(() => {
		setActiveSection("buildings");
	}, []);

	const setOverviewSection = useCallback(() => {
		setActiveSection("overview");
	}, []);

	const setImagePairsSection = useCallback(() => {
		setActiveSection("image-pairs");
		setImagePairsPage(1);
	}, []);

	const setImagePairsSort = useCallback(
		(key: ImagePairSortKey) => {
			setImagePairsPage(1);
			if (imagePairSortKey !== key) {
				setImagePairSortKey(key);
				setImagePairSortDirection("desc");
				return;
			}

			if (imagePairSortDirection === "desc") {
				setImagePairSortDirection("asc");
				return;
			}

			setImagePairSortKey(null);
			setImagePairSortDirection(null);
		},
		[imagePairSortDirection, imagePairSortKey],
	);

	const setBuildingsFilter = useCallback((value: string) => {
		setActiveDamageFilter(value);
		setPage(1);
	}, []);

	const setBuildingSearchFilter = useCallback((value: string) => {
		setBuildingSearchQuery(value);
		setPage(1);
	}, []);

	const setDisasterSearchFilter = useCallback((value: string) => {
		setDisasterSearchQuery(value);
		setPage(1);
	}, []);

	const setXbdSearchFilter = useCallback((value: string) => {
		setXbdSearchQuery(value);
		setPage(1);
	}, []);

	const setPredictedDamageTableFilter = useCallback((value: string) => {
		setPredictedDamageFilter(value);
		setPage(1);
	}, []);

	const setBuildingCorrectnessTableFilter = useCallback(
		(value: BuildingCorrectnessFilter) => {
			setBuildingCorrectnessFilter(value);
			setPage(1);
		},
		[],
	);

	const clearBuildingFilters = useCallback(() => {
		setActiveDamageFilter("all");
		setBuildingSearchQuery("");
		setDisasterSearchQuery("");
		setXbdSearchQuery("");
		setPredictedDamageFilter("all");
		setBuildingCorrectnessFilter("all");
		setPage(1);
	}, []);

	return {
		loadingStats,
		loadingBuildings,
		loadingImagePairs,
		error,
		activeSection,
		selectedDisasterName,
		stats,
		rows,
		page,
		totalPages,
		totalItems,
		predictionMetrics,
		overviewDamageRows,
		activeDamageFilter,
		buildingSearchQuery,
		disasterSearchQuery,
		xbdSearchQuery,
		predictedDamageFilter,
		buildingCorrectnessFilter,
		imagePairRows: sortedImagePairRows,
		imagePairPageRows,
		imagePairPage: imagePairPageClamped,
		imagePairTotalPages,
		imagePairTotalItems,
		imagePairSortKey,
		imagePairSortDirection,
		setDamageFilter,
		setBuildingsFilter,
		setBuildingSearchFilter,
		setDisasterSearchFilter,
		setXbdSearchFilter,
		setPredictedDamageTableFilter,
		setBuildingCorrectnessTableFilter,
		clearBuildingFilters,
		setPage,
		setImagePairsPage,
		setImagePairsSort,
		setOverviewSection,
		setBuildingsSection,
		setImagePairsSection,
	};
}
