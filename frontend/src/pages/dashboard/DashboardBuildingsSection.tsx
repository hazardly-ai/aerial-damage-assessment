import { useNavigate } from "react-router-dom";
import Item from "@/components/ui/Item";
import Pagination from "@/components/ui/Pagination";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DAMAGE_COLOR_HEX } from "@/constants/app";
import { resolveImageUrl } from "@/utils/hazardlyApi";
import type { BuildingListItem } from "./dashboardTypes";
import { DAMAGE_FILTERS, normalizeDamage, prettyLabel } from "./dashboardUtils";

type DashboardBuildingsSectionProps = {
	totalItems: number;
	activeDamageFilter: string;
	showCorrectOnly: boolean;
	onDamageFilterChange: (value: string) => void;
	onShowCorrectOnlyChange: (value: boolean) => void;
	loadingBuildings: boolean;
	page: number;
	rows: BuildingListItem[];
	selectedDisasterName: string | null;
	totalPages: number;
	onPageChange: (page: number) => void;
};

const resolveStorageUrl = (path?: string | null): string | null =>
	path ? resolveImageUrl(path) : null;

export default function DashboardBuildingsSection({
	totalItems,
	activeDamageFilter,
	showCorrectOnly,
	onDamageFilterChange,
	onShowCorrectOnlyChange,
	loadingBuildings,
	page,
	rows,
	selectedDisasterName,
	totalPages,
	onPageChange,
}: DashboardBuildingsSectionProps) {
	const navigate = useNavigate();

	return (
		<div className="relative overflow-hidden rounded-xl border border-border bg-card p-5">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h3 className="text-lg font-semibold">Buildings</h3>
				<div className="flex items-center gap-3">
					<p className="text-xs text-muted-foreground">
						{totalItems} total rows
					</p>
				</div>
			</div>

			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<Select
					value={activeDamageFilter === "all" ? undefined : activeDamageFilter}
					onValueChange={onDamageFilterChange}
				>
					<SelectTrigger className="w-full max-w-48">
						<SelectValue placeholder="Damages" />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectLabel>Damages</SelectLabel>
							{DAMAGE_FILTERS.map((filter) => (
								<SelectItem key={filter.key} value={filter.key}>
									{filter.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>

				<div className="flex items-center gap-2">
					<label htmlFor="align-item" className="text-sm text-muted-foreground">
						Correct
					</label>
					<Switch
						id="align-item"
						checked={showCorrectOnly}
						onCheckedChange={onShowCorrectOnlyChange}
					/>
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
					<table className="w-full min-w-[980px] text-sm">
						<thead>
							<tr className="border-b border-border/60 bg-muted/30 text-left text-muted-foreground">
								<th className="py-2 pr-3 font-medium">Building</th>
								<th className="py-2 pr-3 font-medium">Disaster</th>
								<th className="py-2 pr-3 font-medium">xBD</th>
								<th className="py-2 pr-3 font-medium">Actual</th>
								<th className="py-2 pr-3 font-medium">Predicted</th>
								<th className="py-2 pr-3 font-medium">Correct</th>
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
	);
}
