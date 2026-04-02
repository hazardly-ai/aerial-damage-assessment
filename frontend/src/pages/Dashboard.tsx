import { useCallback, useEffect, useMemo, useState } from "react";
import AppSidebar from "@/components/layout/AppSidebar";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import Item from "@/components/ui/Item";
import Pagination from "@/components/ui/Pagination";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import { DAMAGE_COLOR_HEX } from "@/constants/app";

type DamageLevel =
	| "no-damage"
	| "minor-damage"
	| "major-damage"
	| "destroyed"
	| "un-classified";

type Disaster = {
	id: number;
	name: string;
	type: string;
};

type BuildingListItem = {
	id: number;
	uid: string;
	image_pair_id: number;
	xbd_id: number;
	actual_damage: DamageLevel;
	predicted_damage?: DamageLevel | null;
	is_correct?: boolean | null;
	created_at?: string | null;
	pre_image_path?: string | null;
	post_image_path?: string | null;
};

type PaginatedBuildingsResponse = {
	items: BuildingListItem[];
	page: number;
	page_size: number;
	total_items: number;
	total_pages: number;
};

type BuildingStatsResponse = {
	total: number;
	no_damage: number;
	damaged: number;
	unclassified: number;
	by_damage: Record<string, number>;
};

type BuildingFeatureNoBox = {
	properties: {
		id: number;
		uid: string;
		image_pair_id: number;
		actual_damage: string;
		predicted_damage?: string | null;
		is_correct?: boolean | null;
		created_at?: string | null;
	};
};

type BuildingFeatureCollectionNoBox = {
	features: BuildingFeatureNoBox[];
};

type ImagePairFeatureCollection = {
	features: Array<{
		properties: {
			id: number;
			xbd_id: number;
			pre_image_path?: string | null;
			post_image_path?: string | null;
		};
	}>;
};

type ActiveSection = "overview" | "buildings";

const API_BASE = "http://localhost:8000";
const SATELLITE_IMAGE_BASE_URL =
	(import.meta.env.VITE_SATELLITE_IMAGE_BASE as string | undefined)?.trim() ||
	"https://zbnrjjmqbnqunkjbmsdk.supabase.co/storage/v1/object/public/satellite-images/";
const PAGE_SIZE = 25;
const DAMAGE_FILTERS: Array<{ key: string; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "damaged", label: "Damaged" },
	{ key: "no-damage", label: "No Damage" },
	{ key: "minor-damage", label: "Minor Damage" },
	{ key: "major-damage", label: "Major Damage" },
	{ key: "destroyed", label: "Destroyed" },
	{ key: "un-classified", label: "Unclassified" },
];

const DAMAGED_FILTER_SET = new Set([
	"minor-damage",
	"major-damage",
	"destroyed",
]);

const prettyLabel = (value: string): string =>
	value
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

const normalizeDamage = (raw?: string | null): DamageLevel => {
	if (!raw) return "un-classified";
	if (DAMAGE_FILTERS.some((item) => item.key === raw))
		return raw as DamageLevel;
	return "un-classified";
};

const toPct = (value: number, total: number): string => {
	if (total <= 0) return "0.0";
	return ((value / total) * 100).toFixed(1);
};

const buildStatsFromFeatures = (
	features: BuildingFeatureNoBox[],
): BuildingStatsResponse => {
	const byDamage: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
		"un-classified": 0,
	};

	for (const feature of features) {
		const key = normalizeDamage(feature.properties.actual_damage);
		byDamage[key] = (byDamage[key] ?? 0) + 1;
	}

	const total = features.length;
	const damaged =
		(byDamage["minor-damage"] ?? 0) +
		(byDamage["major-damage"] ?? 0) +
		(byDamage.destroyed ?? 0);

	return {
		total,
		no_damage: byDamage["no-damage"] ?? 0,
		damaged,
		unclassified: byDamage["un-classified"] ?? 0,
		by_damage: byDamage,
	};
};

const resolveStorageUrl = (path?: string | null): string | null => {
	if (!path) return null;
	if (path.startsWith("http://") || path.startsWith("https://")) return path;

	const base = SATELLITE_IMAGE_BASE_URL.endsWith("/")
		? SATELLITE_IMAGE_BASE_URL
		: `${SATELLITE_IMAGE_BASE_URL}/`;

	const normalizedPath = path
		.replace(/^\/+/, "")
		.replace(/^storage\/v1\/object\/public\/satellite-images\//, "")
		.replace(/^satellite-images\//, "");

	return new URL(normalizedPath, base).toString();
};

export default function Dashboard() {
	const [loadingStats, setLoadingStats] = useState(true);
	const [loadingBuildings, setLoadingBuildings] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [supportsPagedEndpoint, setSupportsPagedEndpoint] = useState(true);
	const [activeSection, setActiveSection] = useState<ActiveSection>("overview");
	const [activeDamageFilter, setActiveDamageFilter] = useState<string>("all");
	const [selectedDisasterId, setSelectedDisasterId] = useState<number | null>(
		null,
	);
	const [allBuildingsCache, setAllBuildingsCache] = useState<
		BuildingFeatureNoBox[] | null
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
		damaged: 0,
		unclassified: 0,
		by_damage: {},
	});
	const [rows, setRows] = useState<BuildingListItem[]>([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [totalItems, setTotalItems] = useState(0);

	const ensureImagePairs = useCallback(
		async (disasterId: number) => {
			if (imagePairMap.size > 0) return imagePairMap;
			const res = await fetch(
				`${API_BASE}/disasters/${disasterId}/image-pairs`,
			);
			if (!res.ok) throw new Error("Failed to load image pairs.");
			const data = (await res.json()) as ImagePairFeatureCollection;
			const next = new Map<
				number,
				{
					xbd_id: number;
					pre_image_path?: string | null;
					post_image_path?: string | null;
				}
			>();
			for (const feature of data.features ?? []) {
				next.set(feature.properties.id, {
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
			const res = await fetch(`${API_BASE}/disasters/${disasterId}/buildings`);
			if (!res.ok) throw new Error("Failed to load building data.");
			const data = (await res.json()) as BuildingFeatureCollectionNoBox;
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

				const disasterRes = await fetch(`${API_BASE}/disasters`);
				if (!disasterRes.ok) throw new Error("Failed to load disasters.");

				const disasters = (await disasterRes.json()) as Disaster[];
				if (disasters.length === 0) throw new Error("No disasters available.");

				const currentDisaster = disasters[0];
				setSelectedDisasterId(currentDisaster.id);

				const statsRes = await fetch(
					`${API_BASE}/disasters/${currentDisaster.id}/buildings/stats`,
				);
				if (statsRes.ok) {
					setStats((await statsRes.json()) as BuildingStatsResponse);
				} else if (statsRes.status === 404) {
					const features = await ensureAllBuildings(currentDisaster.id);
					setStats(buildStatsFromFeatures(features));
				} else {
					throw new Error("Failed to load building stats.");
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

	useEffect(() => {
		if (activeSection !== "buildings") return;
		if (selectedDisasterId == null) return;

		const loadBuildingsPage = async () => {
			try {
				setLoadingBuildings(true);
				setError(null);
				const pairs = await ensureImagePairs(selectedDisasterId);
				const isAggregateDamagedFilter = activeDamageFilter === "damaged";

				if (supportsPagedEndpoint && !isAggregateDamagedFilter) {
					const params = new URLSearchParams({
						page: String(page),
						page_size: String(PAGE_SIZE),
					});
					if (activeDamageFilter !== "all")
						params.set("damage", activeDamageFilter);

					const res = await fetch(
						`${API_BASE}/disasters/${selectedDisasterId}/buildings/paged?${params.toString()}`,
					);

					if (res.ok) {
						const payload = (await res.json()) as PaginatedBuildingsResponse;
						setRows(payload.items);
						setTotalPages(payload.total_pages);
						setTotalItems(payload.total_items);
						return;
					}

					if (res.status === 404) {
						setSupportsPagedEndpoint(false);
					} else {
						throw new Error("Failed to load paginated buildings.");
					}
				}

				const features = await ensureAllBuildings(selectedDisasterId);
				const filtered =
					activeDamageFilter === "all"
						? features
						: activeDamageFilter === "damaged"
							? features.filter((feature) =>
									DAMAGED_FILTER_SET.has(
										normalizeDamage(feature.properties.actual_damage),
									),
								)
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
						predicted_damage: normalizeDamage(prop.predicted_damage ?? null),
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

	const overviewDamageRows = useMemo(
		() =>
			DAMAGE_FILTERS.filter((item) => item.key !== "all").map((item) => {
				const count = stats.by_damage[item.key] ?? 0;
				return {
					key: item.key,
					label: item.label,
					count,
					percentage: toPct(count, stats.total),
					color: DAMAGE_COLOR_HEX[item.key] ?? "#9ca3af",
				};
			}),
		[stats],
	);

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
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
									<div className="rounded-xl border border-border bg-card text-card-foreground p-4 lg:col-span-2 flex h-full flex-col">
										<p className="text-sm text-muted-foreground">
											Total Buildings
										</p>
										<p className="mt-2 text-3xl font-bold leading-none">
											{stats.total}
										</p>
										<p className="mt-2 text-xs invisible">
											0% of all mapped buildings
										</p>
										<Button
											variant="outline"
											size="sm"
											className="mt-2"
											onClick={() => setDamageFilter("all")}
										>
											View
										</Button>
									</div>

									<div className="rounded-xl border border-border bg-card text-card-foreground p-4 lg:col-span-2 flex h-full flex-col">
										<p className="text-sm text-muted-foreground">Damaged</p>
										<p className="mt-2 text-3xl font-bold leading-none">
											{stats.damaged}
										</p>
										<p className="mt-2 text-xs text-muted-foreground">
											{toPct(stats.damaged, stats.total)}% of all mapped
											buildings
										</p>
										<Button
											variant="outline"
											size="sm"
											className="mt-auto"
											onClick={() => setDamageFilter("damaged")}
										>
											View
										</Button>
									</div>

									<div className="rounded-xl border border-border bg-card text-card-foreground p-4 lg:col-span-2 flex h-full flex-col">
										<p className="text-sm text-muted-foreground">No Damage</p>
										<p className="mt-2 text-3xl font-bold leading-none">
											{stats.no_damage}
										</p>
										<p className="mt-2 text-xs text-muted-foreground">
											{toPct(stats.no_damage, stats.total)}% of all mapped
											buildings
										</p>
										<Button
											variant="outline"
											size="sm"
											className="mt-auto"
											onClick={() => setDamageFilter("no-damage")}
										>
											View
										</Button>
									</div>
								</div>

								<div className="rounded-xl border border-border bg-card text-card-foreground p-5">
									<h3 className="text-lg font-semibold mb-4">
										Damage Distribution
									</h3>
									<div className="space-y-4">
										{overviewDamageRows.map((row) => (
											<div key={row.key} className="space-y-1.5">
												<div className="flex items-center justify-between text-sm">
													<span className="font-medium">{row.label}</span>
													<span className="text-muted-foreground">
														{row.count} ({row.percentage}%)
													</span>
												</div>
												<div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
													<div
														className="h-full rounded-full"
														style={{
															width: `${row.percentage}%`,
															backgroundColor: row.color,
														}}
													/>
												</div>
											</div>
										))}
									</div>
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
															className="border-b border-border/70 align-top"
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
																<span
																	className="inline-flex rounded-md px-2 py-1 text-xs font-medium text-white"
																	style={{
																		backgroundColor:
																			DAMAGE_COLOR_HEX[
																				normalizeDamage(
																					building.predicted_damage,
																				)
																			],
																	}}
																>
																	{prettyLabel(
																		normalizeDamage(building.predicted_damage),
																	)}
																</span>
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
