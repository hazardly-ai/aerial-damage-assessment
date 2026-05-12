import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import ImagePreviewDialog from "@/components/ui/ImagePreviewDialog";
import Item from "@/components/ui/Item";
import Pagination from "@/components/ui/Pagination";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import { DAMAGE_COLOR_HEX } from "@/constants/app";
import { resolveImageUrl } from "@/utils/hazardlyApi";
import type {
	BuildingCorrectnessFilter,
	BuildingListItem,
	SortDirection,
} from "./dashboardTypes";
import { DAMAGE_FILTERS, normalizeDamage, prettyLabel } from "./dashboardUtils";

type BuildingSortKey =
	| "building"
	| "disaster_name"
	| "xbd_id"
	| "actual_damage"
	| "predicted_damage"
	| "is_correct";

type DashboardBuildingsSectionProps = {
	totalItems: number;
	activeDamageFilter: string;
	buildingSearchQuery: string;
	disasterSearchQuery: string;
	xbdSearchQuery: string;
	predictedDamageFilter: string;
	buildingCorrectnessFilter: BuildingCorrectnessFilter;
	onDamageFilterChange: (value: string) => void;
	onBuildingSearchChange: (value: string) => void;
	onDisasterSearchChange: (value: string) => void;
	onXbdSearchChange: (value: string) => void;
	onPredictedDamageFilterChange: (value: string) => void;
	onBuildingCorrectnessFilterChange: (value: BuildingCorrectnessFilter) => void;
	onClearFilters: () => void;
	loadingBuildings: boolean;
	page: number;
	rows: BuildingListItem[];
	selectedDisasterName: string | null;
	totalPages: number;
	buildingSortKey: BuildingSortKey | null;
	buildingSortDirection: SortDirection | null;
	onPageChange: (page: number) => void;
	onSortChange: (key: BuildingSortKey) => void;
};

type PreviewImage = {
	src: string;
	alt: string;
	title: string;
	subtitle?: string;
};

const resolveStorageUrl = (path?: string | null): string | null =>
	path ? resolveImageUrl(path) : null;

export default function DashboardBuildingsSection({
	totalItems,
	activeDamageFilter,
	buildingSearchQuery,
	disasterSearchQuery,
	xbdSearchQuery,
	predictedDamageFilter,
	buildingCorrectnessFilter,
	onDamageFilterChange,
	onBuildingSearchChange,
	onDisasterSearchChange,
	onXbdSearchChange,
	onPredictedDamageFilterChange,
	onBuildingCorrectnessFilterChange,
	onClearFilters,
	loadingBuildings,
	page,
	rows,
	selectedDisasterName,
	totalPages,
	buildingSortKey,
	buildingSortDirection,
	onPageChange,
	onSortChange,
}: DashboardBuildingsSectionProps) {
	const navigate = useNavigate();
	const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);

	const hasActiveFilters =
		activeDamageFilter !== "all" ||
		buildingSearchQuery !== "" ||
		disasterSearchQuery !== "" ||
		xbdSearchQuery !== "" ||
		predictedDamageFilter !== "all" ||
		buildingCorrectnessFilter !== "all";

	const renderSortIcon = (key: BuildingSortKey) => {
		if (buildingSortKey !== key) {
			return <ArrowUpDown className="h-3.5 w-3.5" />;
		}

		return buildingSortDirection === "asc" ? (
			<ArrowUp className="h-3.5 w-3.5" />
		) : (
			<ArrowDown className="h-3.5 w-3.5" />
		);
	};

	const renderSortableHeader = (label: string, key: BuildingSortKey) => (
		<th className="py-2 pr-3 font-medium" scope="col">
			<button
				type="button"
				onClick={() => onSortChange(key)}
				className="inline-flex items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
			>
				<span>{label}</span>
				{renderSortIcon(key)}
			</button>
		</th>
	);

	return (
		<>
			<div className="dashboard-theme-surface relative overflow-hidden rounded-xl border border-border bg-card p-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h3 className="text-lg font-semibold">Buildings</h3>
					<div className="flex items-center gap-3">
						<p className="text-xs text-muted-foreground">
							{totalItems} total rows
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={onClearFilters}
							disabled={!hasActiveFilters}
						>
							Clear filters
						</Button>
					</div>
				</div>

				{loadingBuildings ? (
					<div className="rounded-md border border-border bg-background p-4">
						<div className="absolute inset-0 z-10 flex items-center justify-center bg-card/40 backdrop-blur-[2px]">
							<SpinnerEmpty
								title="Loading building records"
								description={`Retrieving building rows for page ${page} with the ${prettyLabel(activeDamageFilter)} filter.`}
								className="min-h-[280px] border-0 p-0"
							/>
						</div>
					</div>
				) : (
					<div className="relative z-0 overflow-x-auto">
						<table className="dashboard-theme-table w-full min-w-[980px] text-sm">
							<thead>
								<tr className="border-b border-border/60 bg-muted/30 text-left text-muted-foreground">
									{renderSortableHeader("Building", "building")}
									{renderSortableHeader("Disaster", "disaster_name")}
									{renderSortableHeader("xBD", "xbd_id")}
									{renderSortableHeader("Actual", "actual_damage")}
									{renderSortableHeader("Predicted", "predicted_damage")}
									{renderSortableHeader("Correct", "is_correct")}
								</tr>
								<tr className="border-b border-border/60 bg-background text-left align-top">
									<th className="py-2 pr-3">
										<input
											type="text"
											value={buildingSearchQuery}
											onChange={(event) =>
												onBuildingSearchChange(event.target.value)
											}
											placeholder="Address or UID"
											className="w-full min-w-40 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors duration-theme ease-theme placeholder:text-muted-foreground focus:border-primary"
										/>
									</th>
									<th className="py-2 pr-3">
										<input
											type="text"
											value={disasterSearchQuery}
											onChange={(event) =>
												onDisasterSearchChange(event.target.value)
											}
											placeholder="Disaster name"
											className="w-full min-w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors duration-theme ease-theme placeholder:text-muted-foreground focus:border-primary"
										/>
									</th>
									<th className="py-2 pr-3">
										<input
											type="text"
											inputMode="numeric"
											value={xbdSearchQuery}
											onChange={(event) =>
												onXbdSearchChange(event.target.value)
											}
											placeholder="Scene ID"
											className="w-full min-w-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors duration-theme ease-theme placeholder:text-muted-foreground focus:border-primary"
										/>
									</th>
									<th className="py-2 pr-3">
										<select
											value={activeDamageFilter}
											onChange={(event) =>
												onDamageFilterChange(event.target.value)
											}
											className="w-full min-w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-theme ease-theme focus:border-primary"
										>
											{DAMAGE_FILTERS.map((filter) => (
												<option key={filter.key} value={filter.key}>
													{filter.label}
												</option>
											))}
										</select>
									</th>
									<th className="py-2 pr-3">
										<select
											value={predictedDamageFilter}
											onChange={(event) =>
												onPredictedDamageFilterChange(event.target.value)
											}
											className="w-full min-w-32 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-theme ease-theme focus:border-primary"
										>
											<option value="all">All</option>
											<option value="no-damage">No Damage</option>
											<option value="minor-damage">Minor Damage</option>
											<option value="major-damage">Major Damage</option>
											<option value="destroyed">Destroyed</option>
											<option value="un-classified">Unclassified</option>
										</select>
									</th>
									<th className="py-2 pr-3">
										<select
											value={buildingCorrectnessFilter}
											onChange={(event) =>
												onBuildingCorrectnessFilterChange(
													event.target.value as BuildingCorrectnessFilter,
												)
											}
											className="w-full min-w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-theme ease-theme focus:border-primary"
										>
											<option value="all">All</option>
											<option value="yes">Yes</option>
											<option value="no">No</option>
										</select>
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((building) => {
									const thumbnail = resolveStorageUrl(
										building.post_image_path ?? building.pre_image_path,
									);

									return (
										<tr
											key={building.uid}
											className="cursor-pointer align-top border-b border-border/70 hover:bg-muted/40"
											onClick={() => {
												if (!selectedDisasterName) return;
												const buildingQuery = `building=${encodeURIComponent(building.uid)}`;
												navigate(
													`/map/${selectedDisasterName}/${building.xbd_id}?${buildingQuery}`,
												);
											}}
										>
											<td className="py-3 pr-3">
												<Item
													imageSrc={thumbnail}
													imageAlt={`Building ${building.uid}`}
													title={building.address || building.uid}
													subtitle={building.address ? building.uid : undefined}
													imageOverlayLabel="Preview"
													imageButtonLabel={`Preview building ${building.uid}`}
													onImageClick={() => {
														if (!thumbnail) return;
														setPreviewImage({
															src: thumbnail,
															alt: `Building ${building.uid}`,
															title: building.disaster_name,
															subtitle: `Post-disaster image - xBD ${building.xbd_id}`,
														});
													}}
												/>
											</td>
											<td className="whitespace-nowrap py-3 pr-3 text-xs font-medium">
												{building.disaster_name}
											</td>
											<td className="py-3 pr-3 text-muted-foreground">
												{building.xbd_id}
											</td>
											<td className="py-3 pr-3">
												<span
													className="inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-white"
													style={{
														backgroundColor:
															DAMAGE_COLOR_HEX[
																normalizeDamage(building.actual_damage)
															],
													}}
												>
													{prettyLabel(normalizeDamage(building.actual_damage))}
												</span>
											</td>
											<td className="py-3 pr-3">
												{building.predicted_damage == null ? (
													<span className="text-muted-foreground">-</span>
												) : (
													<span
														className="inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-white"
														style={{
															backgroundColor:
																DAMAGE_COLOR_HEX[building.predicted_damage],
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
										</tr>
									);
								})}
							</tbody>
						</table>
						{rows.length === 0 && (
							<div className="rounded-md border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
								No buildings match the current filters.
							</div>
						)}
					</div>
				)}

				<div className="relative z-20 border-t border-border bg-card px-4 pb-4 pt-2">
					<Pagination
						page={page}
						totalPages={totalPages}
						onPageChange={onPageChange}
					/>
				</div>
			</div>

			{previewImage && (
				<ImagePreviewDialog
					imageSrc={previewImage.src}
					imageAlt={previewImage.alt}
					title={previewImage.title}
					subtitle={previewImage.subtitle}
					onClose={() => setPreviewImage(null)}
				/>
			)}
		</>
	);
}
