import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { rollupBuildingClassificationMetrics } from "@/utils/classificationMetrics";
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
	createEmptyConfusionMatrix,
	macroDamageMetricsFromConfusion,
	normalizeDamage,
	PAGE_SIZE,
} from "./dashboardUtils";

type BuildingSortKey =
	| "building"
	| "disaster_name"
	| "xbd_id"
	| "actual_damage"
	| "predicted_damage"
	| "is_correct";

const compareImagePairRows = (
	left: ImagePairRow,
	right: ImagePairRow,
	key: ImagePairSortKey,
	direction: SortDirection,
) => {
	const multiplier = direction === "asc" ? 1 : -1;
	const getValue = (row: ImagePairRow): number => {
		switch (key) {
			case "xbd_id":
				return row.xbd_id;
			case "totalBuildings":
				return row.totalBuildings;
			case "correctCount":
				return row.correctCount;
			case "incorrectCount":
				return row.incorrectCount;
			case "accuracyPct":
				return row.accuracyPct == null ? -1 : Number(row.accuracyPct);
			default: {
				throw new Error(`Unsupported image pair sort key: ${String(key)}`);
			}
		}
	};

	const leftValue = getValue(left);
	const rightValue = getValue(right);

	if (leftValue < rightValue) return -1 * multiplier;
	if (leftValue > rightValue) return 1 * multiplier;
	return left.xbd_id - right.xbd_id;
};

const compareBuildingRows = (
	left: BuildingListItem,
	right: BuildingListItem,
	key: BuildingSortKey,
	direction: SortDirection,
) => {
	const multiplier = direction === "asc" ? 1 : -1;

	const getValue = (building: BuildingListItem): string | number => {
		switch (key) {
			case "building":
				return (building.address ?? building.uid).toLowerCase();
			case "disaster_name":
				return building.disaster_name.toLowerCase();
			case "xbd_id":
				return building.xbd_id;
			case "actual_damage":
				return building.actual_damage;
			case "predicted_damage":
				return building.predicted_damage ?? "";
			case "is_correct":
				if (building.is_correct === true) return 2;
				if (building.is_correct === false) return 1;
				return 0;
			default: {
				throw new Error(`Unsupported building sort key: ${String(key)}`);
			}
		}
	};

	const leftValue = getValue(left);
	const rightValue = getValue(right);

	if (leftValue < rightValue) return -1 * multiplier;
	if (leftValue > rightValue) return 1 * multiplier;
	return left.id - right.id;
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

type DashboardSessionCache = {
	selectedDisasterId: number | null;
	selectedDisasterName: string | null;
	stats: BuildingStatsResponse | null;
	allBuildingsCache: BuildingFeature[] | null;
	imagePairMap: ImagePairLookup;
};

const DASHBOARD_VIEW_STATE_KEY = "dashboardViewState";

const EMPTY_STATS: BuildingStatsResponse = {
	total: 0,
	no_damage: 0,
	by_damage: {},
};

const dashboardSessionCache: DashboardSessionCache = {
	selectedDisasterId: null,
	selectedDisasterName: null,
	stats: null,
	allBuildingsCache: null,
	imagePairMap: new Map(),
};

const readDashboardViewState = (): {
	activeSection: ActiveSection;
	page: number;
	imagePairsPage: number;
} => {
	if (typeof window === "undefined") {
		return {
			activeSection: "overview",
			page: 1,
			imagePairsPage: 1,
		};
	}

	const raw = window.sessionStorage.getItem(DASHBOARD_VIEW_STATE_KEY);
	if (!raw) {
		return {
			activeSection: "overview",
			page: 1,
			imagePairsPage: 1,
		};
	}

	try {
		const parsed = JSON.parse(raw) as Partial<{
			activeSection: ActiveSection;
			page: number;
			imagePairsPage: number;
		}>;

		return {
			activeSection:
				parsed.activeSection === "buildings" ||
				parsed.activeSection === "image-pairs" ||
				parsed.activeSection === "overview"
					? parsed.activeSection
					: "overview",
			page:
				typeof parsed.page === "number" && parsed.page > 0
					? Math.floor(parsed.page)
					: 1,
			imagePairsPage:
				typeof parsed.imagePairsPage === "number" && parsed.imagePairsPage > 0
					? Math.floor(parsed.imagePairsPage)
					: 1,
		};
	} catch {
		return {
			activeSection: "overview",
			page: 1,
			imagePairsPage: 1,
		};
	}
};

export function useDashboardData() {
	const initialViewState = readDashboardViewState();
	const [loadingStats, setLoadingStats] = useState(
		dashboardSessionCache.stats == null,
	);
	const [loadingBuildings, setLoadingBuildings] = useState(false);
	const [loadingImagePairs, setLoadingImagePairs] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeSection, setActiveSection] = useState<ActiveSection>(
		initialViewState.activeSection,
	);
	const [activeDamageFilter, setActiveDamageFilter] = useState<string>("all");
	const [buildingSearchQuery, setBuildingSearchQuery] = useState("");
	const [disasterSearchQuery, setDisasterSearchQuery] = useState("");
	const [xbdSearchQuery, setXbdSearchQuery] = useState("");
	const [predictedDamageFilter, setPredictedDamageFilter] =
		useState<string>("all");
	const [buildingCorrectnessFilter, setBuildingCorrectnessFilter] =
		useState<BuildingCorrectnessFilter>("all");
	const [selectedDisasterId, setSelectedDisasterId] = useState<number | null>(
		dashboardSessionCache.selectedDisasterId,
	);
	const [selectedDisasterName, setSelectedDisasterName] = useState<
		string | null
	>(dashboardSessionCache.selectedDisasterName);
	const [allBuildingsCache, setAllBuildingsCache] = useState<
		BuildingFeature[] | null
	>(dashboardSessionCache.allBuildingsCache);
	const [imagePairMap, setImagePairMap] = useState<ImagePairLookup>(
		dashboardSessionCache.imagePairMap,
	);
	const [stats, setStats] = useState<BuildingStatsResponse>(
		dashboardSessionCache.stats ?? EMPTY_STATS,
	);
	const [page, setPage] = useState(initialViewState.page);
	const [buildingSortKey, setBuildingSortKey] =
		useState<BuildingSortKey | null>(null);
	const [buildingSortDirection, setBuildingSortDirection] =
		useState<SortDirection | null>(null);
	const [imagePairsPage, setImagePairsPage] = useState(
		initialViewState.imagePairsPage,
	);
	const [imagePairSortKey, setImagePairSortKey] =
		useState<ImagePairSortKey | null>(null);
	const [imagePairSortDirection, setImagePairSortDirection] =
		useState<SortDirection | null>(null);
	const imagePairMapRef = useRef(imagePairMap);
	const allBuildingsCacheRef = useRef(allBuildingsCache);
	const hasLoadedInitialStatsRef = useRef(dashboardSessionCache.stats != null);

	imagePairMapRef.current = imagePairMap;
	allBuildingsCacheRef.current = allBuildingsCache;

	const deferredBuildingSearchQuery = useDeferredValue(buildingSearchQuery);
	const deferredDisasterSearchQuery = useDeferredValue(disasterSearchQuery);
	const deferredXbdSearchQuery = useDeferredValue(xbdSearchQuery);

	useEffect(() => {
		if (typeof window === "undefined") return;

		window.sessionStorage.setItem(
			DASHBOARD_VIEW_STATE_KEY,
			JSON.stringify({
				activeSection,
				page,
				imagePairsPage,
			}),
		);
	}, [activeSection, imagePairsPage, page]);

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
		dashboardSessionCache.imagePairMap = next;
		setImagePairMap(next);
		return next;
	}, []);

	const ensureAllBuildings = useCallback(async (disasterId: number) => {
		if (allBuildingsCacheRef.current) return allBuildingsCacheRef.current;
		const data = await fetchBuildingsForDisaster(disasterId);
		const features = data.features ?? [];
		allBuildingsCacheRef.current = features;
		dashboardSessionCache.allBuildingsCache = features;
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
				dashboardSessionCache.selectedDisasterId = currentDisaster.id;
				dashboardSessionCache.selectedDisasterName = currentDisaster.name;
				setSelectedDisasterId(currentDisaster.id);
				setSelectedDisasterName(currentDisaster.name);

				const nextStats = await fetchBuildingStatsForDisaster(
					currentDisaster.id,
				).catch(async (err: unknown) => {
					if (err instanceof ApiError && err.status === 404) {
						const features = await ensureAllBuildings(currentDisaster.id);
						return buildStatsFromFeatures(features);
					}

					throw err;
				});
				dashboardSessionCache.stats = nextStats;
				setStats(nextStats);

				void ensureAllBuildings(currentDisaster.id).catch((prefetchError) => {
					setError(
						prefetchError instanceof Error
							? prefetchError.message
							: "Unexpected dashboard error.",
					);
				});
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
		const emptyMatrix = createEmptyConfusionMatrix();

		if (!allBuildingsCache) {
			return {
				correctCount: 0,
				comparedCount: 0,
				accuracyPct: "0.0",
				confusionMatrix: emptyMatrix,
				available: false,
				matrixTotal: 0,
				matrixMax: 0,
				macroMetrics: macroDamageMetricsFromConfusion(emptyMatrix, 0),
			};
		}

		const r = rollupBuildingClassificationMetrics(allBuildingsCache);

		return {
			correctCount: r.correctCount,
			comparedCount: r.comparedCount,
			accuracyPct:
				r.comparedCount > 0
					? ((r.correctCount / r.comparedCount) * 100).toFixed(1)
					: "0.0",
			confusionMatrix: r.confusionMatrix,
			available: r.comparedCount > 0,
			matrixTotal: r.comparedCount,
			matrixMax: r.matrixMax,
			macroMetrics: macroDamageMetricsFromConfusion(
				r.confusionMatrix,
				r.comparedCount,
			),
		};
	}, [allBuildingsCache]);

	const allBuildingRows = useMemo<BuildingListItem[]>(() => {
		if (!allBuildingsCache) return [];

		return allBuildingsCache.map((feature) => {
			const prop = feature.properties;
			const pair = imagePairMap.get(prop.image_pair_id);
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
	}, [allBuildingsCache, imagePairMap, selectedDisasterName]);

	useEffect(() => {
		if (activeSection !== "buildings") return;
		if (selectedDisasterId == null) return;

		const loadBuildingsData = async () => {
			try {
				setLoadingBuildings(true);
				setError(null);

				await Promise.all([
					ensureImagePairs(selectedDisasterId),
					ensureAllBuildings(selectedDisasterId),
				]);
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: "Unexpected dashboard error while loading buildings.",
				);
			} finally {
				setLoadingBuildings(false);
			}
		};

		void loadBuildingsData();
	}, [activeSection, selectedDisasterId, ensureAllBuildings, ensureImagePairs]);

	const filteredBuildingRows = useMemo(() => {
		const normalizedBuildingQuery = deferredBuildingSearchQuery
			.trim()
			.toLowerCase();
		const normalizedDisasterQuery = deferredDisasterSearchQuery
			.trim()
			.toLowerCase();
		const normalizedXbdQuery = deferredXbdSearchQuery.trim();

		return allBuildingRows.filter((building) => {
			if (
				activeDamageFilter !== "all" &&
				building.actual_damage !== activeDamageFilter
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
				!building.disaster_name.toLowerCase().includes(normalizedDisasterQuery)
			) {
				return false;
			}

			return (
				!normalizedXbdQuery ||
				matchesWildcard(String(building.xbd_id), normalizedXbdQuery)
			);
		});
	}, [
		activeDamageFilter,
		allBuildingRows,
		buildingCorrectnessFilter,
		deferredBuildingSearchQuery,
		deferredDisasterSearchQuery,
		deferredXbdSearchQuery,
		predictedDamageFilter,
	]);

	const sortedBuildingRows = useMemo(() => {
		if (buildingSortKey == null || buildingSortDirection == null) {
			return filteredBuildingRows;
		}

		return [...filteredBuildingRows].sort((left, right) =>
			compareBuildingRows(left, right, buildingSortKey, buildingSortDirection),
		);
	}, [buildingSortDirection, buildingSortKey, filteredBuildingRows]);

	const totalItems = sortedBuildingRows.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
	const clampedPage = Math.min(page, totalPages);

	useEffect(() => {
		if (page !== clampedPage) {
			setPage(clampedPage);
		}
	}, [clampedPage, page]);

	const rows = useMemo(() => {
		const start = (clampedPage - 1) * PAGE_SIZE;
		return sortedBuildingRows.slice(start, start + PAGE_SIZE);
	}, [clampedPage, sortedBuildingRows]);

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

	const setBuildingsSort = useCallback(
		(key: BuildingSortKey) => {
			setPage(1);
			if (buildingSortKey !== key) {
				setBuildingSortKey(key);
				setBuildingSortDirection("desc");
				return;
			}

			if (buildingSortDirection === "desc") {
				setBuildingSortDirection("asc");
				return;
			}

			setBuildingSortKey(null);
			setBuildingSortDirection(null);
		},
		[buildingSortDirection, buildingSortKey],
	);

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
		buildingSortKey,
		buildingSortDirection,
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
		setBuildingsSort,
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
