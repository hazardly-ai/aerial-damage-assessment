import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppSidebar from "@/components/layout/AppSidebar";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import Item from "@/components/ui/Item";
import Pagination from "@/components/ui/Pagination";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { DAMAGE_COLOR_HEX } from "@/constants/app";
import {
	ApiError,
	type BuildingFeature,
	type BuildingStatsResponse,
	type DisasterSummary,
	fetchBuildingStatsForDisaster,
	fetchBuildingsForDisaster,
	fetchDisasters,
	fetchImagePairs,
	fetchPaginatedBuildingsForDisaster,
	type ImagePairFeature,
	resolveImageUrl,
} from "@/utils/hazardlyApi";

type DamageLevel = "no-damage" | "minor-damage" | "major-damage" | "destroyed";

type NormalizedDamage = DamageLevel | "un-classified";

type BuildingListItem = {
	id: number;
	uid: string;
	image_pair_id: number;
	xbd_id: number;
	actual_damage: NormalizedDamage;
	predicted_damage?: NormalizedDamage | null;
	is_correct?: boolean | null;
	created_at?: string | null;
	pre_image_path?: string | null;
	post_image_path?: string | null;
};

type ActiveSection = "overview" | "buildings";

const CONFUSION_LABELS: DamageLevel[] = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
];

const PAGE_SIZE = 25;
const DAMAGE_FILTERS: Array<{ key: string; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "no-damage", label: "No Damage" },
	{ key: "minor-damage", label: "Minor Damage" },
	{ key: "major-damage", label: "Major Damage" },
	{ key: "destroyed", label: "Destroyed" },
];

const prettyLabel = (value: string): string =>
	value
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

const normalizeDamage = (raw?: string | null): NormalizedDamage => {
	if (!raw) return "un-classified";

	const normalized = raw
		.toLowerCase()
		.trim()
		.replace(/[_\s]+/g, "-")
		.replace(/-+/g, "-");

	if (normalized === "no-damage" || normalized === "no-damages")
		return "no-damage";
	if (normalized === "minor-damage" || normalized === "minor-damages")
		return "minor-damage";
	if (normalized === "major-damage" || normalized === "major-damages")
		return "major-damage";
	if (normalized === "destroyed" || normalized === "destroy")
		return "destroyed";
	if (
		normalized === "un-classified" ||
		normalized === "unclassified" ||
		normalized === "unknown" ||
		normalized === "uncertain"
	)
		return "un-classified";

	if (DAMAGE_FILTERS.some((item) => item.key === normalized)) {
		return normalized as NormalizedDamage;
	}

	return "un-classified";
};

const toPct = (value: number, total: number): string => {
	if (total <= 0) return "0.0";
	return ((value / total) * 100).toFixed(1);
};

const createEmptyConfusionMatrix = (): Record<
	DamageLevel,
	Record<DamageLevel, number>
> => ({
	"no-damage": {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	},
	"minor-damage": {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	},
	"major-damage": {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	},
	destroyed: {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	},
});

const buildStatsFromFeatures = (
	features: BuildingFeature[],
): BuildingStatsResponse => {
	const byDamage: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};

	for (const feature of features) {
		const key = normalizeDamage(feature.properties.actual_damage);
		if (key === "un-classified") continue;
		byDamage[key] = (byDamage[key] ?? 0) + 1;
	}

	const total = features.length;

	return {
		total,
		no_damage: byDamage["no-damage"] ?? 0,
		by_damage: byDamage,
	};
};

const resolveStorageUrl = (path?: string | null): string | null =>
	path ? resolveImageUrl(path) : null;

export default function Dashboard() {
	const navigate = useNavigate();
	const [loadingStats, setLoadingStats] = useState(true);
	const [loadingBuildings, setLoadingBuildings] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [supportsPagedEndpoint, setSupportsPagedEndpoint] = useState(true);
	const [activeSection, setActiveSection] = useState<ActiveSection>("overview");
	const [activeDamageFilter, setActiveDamageFilter] = useState<string>("all");
	const [selectedDisasterId, setSelectedDisasterId] = useState<number | null>(
		null,
	);
	const [selectedDisasterName, setSelectedDisasterName] = useState<
		string | null
	>(null);
	const [allBuildingsCache, setAllBuildingsCache] = useState<
		BuildingFeature[] | null
	>(null);
	const [imagePairMap, setImagePairMap] = useState<
		Map<
			number,
			{
				xbd_id: number;
				pre_image_path?: string | null;
				post_image_path?: string | null;
			}
		>
	>(new Map());
	const [stats, setStats] = useState<BuildingStatsResponse>({
		total: 0,
		no_damage: 0,
		by_damage: {},
	});
	const [rows, setRows] = useState<BuildingListItem[]>([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [totalItems, setTotalItems] = useState(0);

	const ensureImagePairs = useCallback(
		async (disasterId: number) => {
			if (imagePairMap.size > 0) return imagePairMap;
			const data = await fetchImagePairs(disasterId);
			const next = new Map<
				number,
				{
					xbd_id: number;
					pre_image_path?: string | null;
					post_image_path?: string | null;
				}
			>();
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
			setImagePairMap(next);
			return next;
		},
		[imagePairMap],
	);

	const ensureAllBuildings = useCallback(
		async (disasterId: number) => {
			if (allBuildingsCache) return allBuildingsCache;
			const data = await fetchBuildingsForDisaster(disasterId);
			const features = data.features ?? [];
			setAllBuildingsCache(features);
			return features;
		},
		[allBuildingsCache],
	);

	useEffect(() => {
		const loadStats = async () => {
			try {
				setLoadingStats(true);
				setError(null);

				const disasters = (await fetchDisasters()) as DisasterSummary[];
				if (disasters.length === 0) throw new Error("No disasters available.");

				const currentDisaster = disasters[0];
				setSelectedDisasterId(currentDisaster.id);
				setSelectedDisasterName(currentDisaster.name);

				// Load full building features so overview metrics (accuracy/confusion matrix)
				// can be derived even if the stats endpoint is available.
				void ensureAllBuildings(currentDisaster.id);

				try {
					const stats = await fetchBuildingStatsForDisaster(currentDisaster.id);
					setStats(stats);
				} catch (err: unknown) {
					if (err instanceof ApiError && err.status === 404) {
						const features = await ensureAllBuildings(currentDisaster.id);
						setStats(buildStatsFromFeatures(features));
					} else {
						throw err;
					}
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

	const predictionMetrics = useMemo(() => {
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

		const accuracyPct =
			comparedCount > 0
				? ((correctCount / comparedCount) * 100).toFixed(1)
				: "0.0";

		return {
			correctCount,
			comparedCount,
			accuracyPct,
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

				if (supportsPagedEndpoint) {
					try {
						const payload = await fetchPaginatedBuildingsForDisaster(
							selectedDisasterId,
							{
								page,
								pageSize: PAGE_SIZE,
								damage: activeDamageFilter,
							},
						);
						setRows(
							payload.items.map((item) => ({
								...item,
								actual_damage: normalizeDamage(item.actual_damage),
								predicted_damage:
									item.predicted_damage == null
										? null
										: normalizeDamage(item.predicted_damage),
							})),
						);
						setTotalPages(payload.total_pages);
						setTotalItems(payload.total_items);
						return;
					} catch (err: unknown) {
						if (err instanceof ApiError && err.status === 404) {
							setSupportsPagedEndpoint(false);
						} else {
							throw err;
						}
					}
				}

				const features = await ensureAllBuildings(selectedDisasterId);
				const filtered =
					activeDamageFilter === "all"
						? features
						: features.filter(
								(feature) =>
									normalizeDamage(feature.properties.actual_damage) ===
									activeDamageFilter,
							);

				const mapped: BuildingListItem[] = filtered.map((feature) => {
					const prop = feature.properties;
					const pair = pairs.get(prop.image_pair_id);
					return {
						id: prop.id,
						uid: prop.uid,
						image_pair_id: prop.image_pair_id,
						xbd_id: pair?.xbd_id ?? -1,
						actual_damage: normalizeDamage(prop.actual_damage),
						predicted_damage:
							prop.predicted_damage == null
								? null
								: normalizeDamage(prop.predicted_damage),
						is_correct: prop.is_correct ?? null,
						created_at: prop.created_at ?? null,
						pre_image_path: pair?.pre_image_path ?? null,
						post_image_path: pair?.post_image_path ?? null,
					};
				});

				const total = mapped.length;
				const pages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
				const start = (page - 1) * PAGE_SIZE;
				const end = start + PAGE_SIZE;

				setRows(mapped.slice(start, end));
				setTotalPages(pages);
				setTotalItems(total);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Unable to load buildings.",
				);
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
		supportsPagedEndpoint,
		ensureAllBuildings,
		ensureImagePairs,
	]);

	const overviewDamageRows = useMemo(() => {
		const predictedByDamage: Record<string, number> = {
			"no-damage": 0,
			"minor-damage": 0,
			"major-damage": 0,
			destroyed: 0,
		};

		let predictedTotal = 0;
		for (const feature of allBuildingsCache ?? []) {
			const rawPredicted = feature.properties.predicted_damage;
			if (rawPredicted == null) continue;
			const key = normalizeDamage(rawPredicted);
			if (key === "un-classified") continue;
			predictedByDamage[key] = (predictedByDamage[key] ?? 0) + 1;
			predictedTotal += 1;
		}

		return DAMAGE_FILTERS.filter((item) => item.key !== "all").map((item) => {
			const actualCount = stats.by_damage[item.key] ?? 0;
			const predictedCount = predictedByDamage[item.key] ?? 0;
			const classKey = item.key as DamageLevel;
			const actualTotalWithPrediction = CONFUSION_LABELS.reduce(
				(sum, predictedLabel) =>
					sum +
					(predictionMetrics.confusionMatrix[classKey][predictedLabel] ?? 0),
				0,
			);
			const diagonal =
				predictionMetrics.confusionMatrix[classKey][classKey] ?? 0;
			const classAccuracy =
				actualTotalWithPrediction > 0
					? `${toPct(diagonal, actualTotalWithPrediction)}%`
					: "0.0%";
			return {
				key: item.key,
				label: item.label,
				actualCount,
				actualPercentage: toPct(actualCount, stats.total),
				predictedCount,
				predictedPercentage: toPct(predictedCount, predictedTotal),
				classAccuracy,
				color: DAMAGE_COLOR_HEX[item.key] ?? "#9ca3af",
			};
		});
	}, [stats, allBuildingsCache, predictionMetrics]);

	const setDamageFilter = (filter: string) => {
		setActiveDamageFilter(filter);
		setPage(1);
		setActiveSection("buildings");
	};

	return (
		<div className="min-h-screen bg-background text-foreground">
			<Header />
			<div className="mx-auto w-full max-w-7xl px-6 py-8">
				<div className="flex flex-row gap-6 items-start">
					<AppSidebar
						activeSection={activeSection}
						activeDamageFilter={activeDamageFilter}
						filters={DAMAGE_FILTERS}
						onOverview={() => setActiveSection("overview")}
						onSelectFilter={setDamageFilter}
					/>

					<div className="space-y-6 min-w-0 flex-1">
						{loadingStats && (
							<div className="rounded-xl border border-border bg-card p-4">
								<SpinnerEmpty
									title="Preparing dashboard"
									description="Fetching disaster metadata and damage statistics to populate the overview cards."
									className="min-h-[180px] border-0 p-0"
								/>
							</div>
						)}

						{error && (
							<div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
								{error}
							</div>
						)}

						{activeSection === "overview" && (
							<>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
									<div className="rounded-xl border border-border bg-card text-card-foreground p-4 flex min-h-[180px] flex-col">
										<p className="text-sm text-muted-foreground">
											Total Buildings
										</p>
										<p className="mt-2 text-4xl font-bold leading-none">
											{stats.total}
										</p>
										<Button
											variant="outline"
											size="sm"
											className="mt-auto"
											onClick={() => setDamageFilter("all")}
										>
											View
										</Button>
									</div>

									<div className="rounded-xl border border-border bg-card text-card-foreground p-4 flex min-h-[180px] flex-col">
										<p className="text-sm text-muted-foreground">
											Overall Accuracy
										</p>
										<p className="mt-2 text-4xl font-bold leading-none">
											{predictionMetrics.available
												? `${predictionMetrics.accuracyPct}%`
												: "N/A"}
										</p>
										<div className="mt-auto space-y-1">
											<p className="text-xs text-muted-foreground">
												{predictionMetrics.correctCount} exact matches from{" "}
												{predictionMetrics.comparedCount} predictions
											</p>
											<p className="text-[11px] text-muted-foreground">
												Exact class match between ground truth and VLM output.
											</p>
										</div>
									</div>
								</div>

								<div className="rounded-xl border border-border bg-card text-card-foreground p-5">
									<div className="mb-4 flex items-center justify-between gap-3">
										<h3 className="text-lg font-semibold">
											Damage Distribution
										</h3>
										<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
											<span
												className="h-2 w-2 rounded-full"
												style={{ backgroundColor: "#2563eb", opacity: 0.85 }}
											/>
											Predicted
										</span>
									</div>
									<div className="space-y-4">
										<TooltipProvider>
											{overviewDamageRows.map((row) => (
												<div key={row.key} className="space-y-1.5">
													<div className="flex items-center justify-between text-sm">
														<span className="font-medium">{row.label}</span>
														<span className="text-xs text-muted-foreground">
															{row.classAccuracy}
														</span>
													</div>

													<Tooltip>
														<TooltipTrigger asChild>
															<div className="relative h-2.5 w-full cursor-help overflow-hidden rounded-full bg-muted">
																<div
																	className="absolute left-0 top-0 h-2.5 rounded-full"
																	style={{
																		width: `${row.actualPercentage}%`,
																		backgroundColor: row.color,
																		opacity: 0.75,
																	}}
																/>
															</div>
														</TooltipTrigger>
														<TooltipContent side="top">
															<p>
																Actual: {row.actualCount} (
																{row.actualPercentage}%)
															</p>
														</TooltipContent>
													</Tooltip>

													<Tooltip>
														<TooltipTrigger asChild>
															<div className="relative h-2.5 w-full cursor-help overflow-hidden rounded-full bg-muted">
																<div
																	className="absolute left-0 top-0 h-2.5 rounded-full"
																	style={{
																		width: `${row.predictedPercentage}%`,
																		backgroundColor: "#2563eb",
																		opacity: 0.85,
																	}}
																/>
															</div>
														</TooltipTrigger>
														<TooltipContent side="top">
															<p>
																Predicted: {row.predictedCount} (
																{row.predictedPercentage}%)
															</p>
														</TooltipContent>
													</Tooltip>
												</div>
											))}
										</TooltipProvider>
									</div>
								</div>

								<div className="rounded-xl border border-border bg-card text-card-foreground p-5">
									<div className="mb-4 flex items-end justify-between gap-3">
										<div>
											<h3 className="text-lg font-semibold">
												Confusion Matrix Heatmap
											</h3>
											<p className="text-xs text-muted-foreground">
												Rows = actual labels, columns = VLM predictions
											</p>
										</div>
										<p className="text-xs text-muted-foreground">
											{predictionMetrics.matrixTotal} predictions compared
										</p>
									</div>

									{predictionMetrics.available ? (
										<div className="overflow-x-auto">
											<table className="w-full min-w-[760px] text-sm">
												<thead>
													<tr className="border-b border-border text-left text-muted-foreground">
														<th className="px-2 py-2 font-medium">
															Actual \ Predicted
														</th>
														{CONFUSION_LABELS.map((predictedLabel) => (
															<th
																key={`pred-${predictedLabel}`}
																className="px-2 py-2 font-medium text-center"
															>
																{prettyLabel(predictedLabel)}
															</th>
														))}
														<th className="px-2 py-2 font-medium text-center">
															Total
														</th>
													</tr>
												</thead>
												<tbody>
													{CONFUSION_LABELS.map((actualLabel) => {
														const rowTotal = CONFUSION_LABELS.reduce(
															(sum, predictedLabel) =>
																sum +
																(predictionMetrics.confusionMatrix[actualLabel][
																	predictedLabel
																] ?? 0),
															0,
														);

														return (
															<tr
																key={`row-${actualLabel}`}
																className="border-b border-border/70"
															>
																<td className="px-2 py-2 font-medium">
																	{prettyLabel(actualLabel)}
																</td>
																{CONFUSION_LABELS.map((predictedLabel) => {
																	const value =
																		predictionMetrics.confusionMatrix[
																			actualLabel
																		][predictedLabel] ?? 0;
																	const isDiagonal =
																		actualLabel === predictedLabel;
																	const intensity =
																		predictionMetrics.matrixMax > 0
																			? value / predictionMetrics.matrixMax
																			: 0;
																	const alpha =
																		value > 0 ? 0.15 + intensity * 0.55 : 0.06;
																	const backgroundColor = isDiagonal
																		? `rgba(16, 185, 129, ${alpha})`
																		: `rgba(239, 68, 68, ${alpha})`;

																	return (
																		<td
																			key={`cell-${actualLabel}-${predictedLabel}`}
																			className={`px-2 py-2 text-center font-medium ${
																				isDiagonal
																					? "text-emerald-900"
																					: "text-rose-900"
																			}`}
																			style={{ backgroundColor }}
																		>
																			{value}
																		</td>
																	);
																})}
																<td className="px-2 py-2 text-center font-semibold text-muted-foreground">
																	{rowTotal}
																</td>
															</tr>
														);
													})}
												</tbody>
											</table>
										</div>
									) : (
										<div className="rounded-md border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
											No predicted VLM labels available yet to build the
											confusion matrix.
										</div>
									)}
								</div>
							</>
						)}

						{activeSection === "buildings" && (
							<div className="rounded-xl border border-border bg-card text-card-foreground p-5">
								<div className="flex items-center justify-between mb-4 gap-3">
									<h3 className="text-lg font-semibold">Buildings</h3>
									<p className="text-xs text-muted-foreground">
										{totalItems} total rows
									</p>
								</div>

								{loadingBuildings ? (
									<div className="rounded-md border border-border bg-background p-4">
										<SpinnerEmpty
											title="Loading building records"
											description={`Retrieving building rows for page ${page} with the ${prettyLabel(activeDamageFilter)} filter.`}
											className="min-h-[280px] border-0 p-0"
										/>
									</div>
								) : (
									<div className="overflow-x-auto">
										<table className="w-full min-w-[980px] text-sm">
											<thead>
												<tr className="border-b border-border text-left text-muted-foreground">
													<th className="py-2 pr-3 font-medium">Building</th>
													<th className="py-2 pr-3 font-medium">ID</th>
													<th className="py-2 pr-3 font-medium">Image Pair</th>
													<th className="py-2 pr-3 font-medium">Actual</th>
													<th className="py-2 pr-3 font-medium">Predicted</th>
													<th className="py-2 pr-3 font-medium">Correct</th>
													<th className="py-2 pr-0 font-medium">Created</th>
												</tr>
											</thead>
											<tbody>
												{rows.map((building) => {
													const thumbnail = resolveStorageUrl(
														building.post_image_path ?? building.pre_image_path,
													);
													const created = building.created_at
														? new Date(building.created_at).toLocaleString()
														: "-";

													return (
														<tr
															key={building.uid}
															className="border-b border-border/70 align-top cursor-pointer hover:bg-muted/40"
															onClick={() => {
																if (!selectedDisasterName) return;
																navigate(
																	`/${selectedDisasterName ?? "unknown"}/${building.xbd_id}`,
																);
															}}
														>
															<td className="py-3 pr-3">
																<Item
																	imageSrc={thumbnail}
																	imageAlt={`Building ${building.uid}`}
																	title={building.uid}
																	subtitle={`xBD: ${building.xbd_id}`}
																	meta={`Image Pair ID: ${building.image_pair_id}`}
																/>
															</td>
															<td className="py-3 pr-3 text-muted-foreground">
																{building.id}
															</td>
															<td className="py-3 pr-3 text-muted-foreground">
																{building.image_pair_id}
															</td>
															<td className="py-3 pr-3">
																<span
																	className="inline-flex rounded-md px-2 py-1 text-xs font-medium text-white"
																	style={{
																		backgroundColor:
																			DAMAGE_COLOR_HEX[
																				normalizeDamage(building.actual_damage)
																			],
																	}}
																>
																	{prettyLabel(
																		normalizeDamage(building.actual_damage),
																	)}
																</span>
															</td>
															<td className="py-3 pr-3">
																{building.predicted_damage == null ? (
																	<span className="text-muted-foreground">
																		-
																	</span>
																) : (
																	<span
																		className="inline-flex rounded-md px-2 py-1 text-xs font-medium text-white"
																		style={{
																			backgroundColor:
																				DAMAGE_COLOR_HEX[
																					building.predicted_damage
																				],
																		}}
																	>
																		{prettyLabel(building.predicted_damage)}
																	</span>
																)}
															</td>
															<td className="py-3 pr-3 text-muted-foreground">
																{typeof building.is_correct === "boolean"
																	? building.is_correct
																		? "Yes"
																		: "No"
																	: "-"}
															</td>
															<td className="py-3 pr-0 text-muted-foreground">
																{created}
															</td>
														</tr>
													);
												})}
											</tbody>
										</table>
									</div>
								)}

								<Pagination
									page={page}
									totalPages={totalPages}
									onPageChange={setPage}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
