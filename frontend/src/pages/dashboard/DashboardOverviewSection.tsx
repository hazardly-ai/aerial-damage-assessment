import { Button } from "@/components/ui/Button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	DamageLevel,
	OverviewDamageRow,
	PredictionMetrics,
} from "./dashboardTypes";
import { CONFUSION_LABELS, prettyLabel } from "./dashboardUtils";

type DashboardOverviewSectionProps = {
	loadingStats: boolean;
	loadingBuildings: boolean;
	totalBuildings: number;
	predictionMetrics: PredictionMetrics;
	overviewDamageRows: OverviewDamageRow[];
	onViewBuildings: (filter: string) => void;
};

const getCellBackgroundColor = (
	actualLabel: DamageLevel,
	predictedLabel: DamageLevel,
	value: number,
	matrixMax: number,
): string => {
	const isDiagonal = actualLabel === predictedLabel;
	const intensity = matrixMax > 0 ? value / matrixMax : 0;
	const isDark = document.documentElement.classList.contains("dark");
	const baseAlpha = isDark ? 0.25 : 0.15;
	const scale = isDark ? 0.65 : 0.55;
	const alpha =
		value > 0 ? baseAlpha + intensity * scale : isDark ? 0.08 : 0.06;
	const isTopLeft =
		actualLabel === "no-damage" && predictedLabel === "no-damage";

	if (isTopLeft) {
		return isDark
			? `rgba(5, 150, 105, ${Math.min(0.95, alpha + 0.25)})`
			: `rgba(16, 185, 129, ${alpha})`;
	}

	return isDiagonal
		? `rgba(16, 185, 129, ${alpha})`
		: `rgba(239, 68, 68, ${alpha})`;
};

export default function DashboardOverviewSection({
	loadingStats,
	loadingBuildings,
	totalBuildings,
	predictionMetrics,
	overviewDamageRows,
	onViewBuildings,
}: DashboardOverviewSectionProps) {
	return (
		<div
			className={`ui-fade-opacity ${
				loadingStats ? "pointer-events-none opacity-20" : "opacity-100"
			} flex flex-col gap-6`}
		>
			<div
				className={`rounded-xl border border-border bg-card p-5 text-card-foreground ${
					loadingBuildings ? "opacity-50" : "opacity-100"
				}`}
			>
				<div className="mb-4 flex items-end justify-between gap-3">
					<h3 className="text-lg font-semibold">Overview</h3>
				</div>
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="flex min-h-[180px] flex-col rounded-lg border border-border/60 bg-muted/20 p-4">
							<p className="text-sm text-muted-foreground">Total Buildings</p>
							<p className="mt-2 text-4xl font-bold leading-none text-card-foreground">
								{totalBuildings}
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-auto"
								onClick={() => onViewBuildings("all")}
							>
								View
							</Button>
						</div>

						<div className="flex min-h-[180px] flex-col rounded-lg border border-border/60 bg-muted/20 p-4">
							<p className="text-sm text-muted-foreground">Overall Accuracy</p>
							<p className="mt-2 text-4xl font-bold leading-none text-card-foreground">
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

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<div className="flex flex-col rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
							<p className="text-sm text-muted-foreground">Precision</p>
							<p className="mt-1 text-3xl font-bold leading-none text-card-foreground">
								{predictionMetrics.macroMetrics.available &&
								predictionMetrics.macroMetrics.precisionMacroPct != null
									? `${predictionMetrics.macroMetrics.precisionMacroPct}%`
									: "N/A"}
							</p>
						</div>
						<div className="flex flex-col rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
							<p className="text-sm text-muted-foreground">Recall</p>
							<p className="mt-1 text-3xl font-bold leading-none text-card-foreground">
								{predictionMetrics.macroMetrics.available &&
								predictionMetrics.macroMetrics.recallMacroPct != null
									? `${predictionMetrics.macroMetrics.recallMacroPct}%`
									: "N/A"}
							</p>
						</div>
						<div className="flex flex-col rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
							<p className="text-sm text-muted-foreground">F1</p>
							<p className="mt-1 text-3xl font-bold leading-none text-card-foreground">
								{predictionMetrics.macroMetrics.available &&
								predictionMetrics.macroMetrics.f1MacroPct != null
									? `${predictionMetrics.macroMetrics.f1MacroPct}%`
									: "N/A"}
							</p>
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-xl border border-border bg-card p-5 text-card-foreground">
				<div className="mb-4 flex items-end justify-between gap-3">
					<h3 className="text-lg font-semibold">Damage Distribution</h3>
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
											Actual: {row.actualCount} ({row.actualPercentage}%)
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
											Predicted: {row.predictedCount} ({row.predictedPercentage}
											%)
										</p>
									</TooltipContent>
								</Tooltip>
							</div>
						))}
					</TooltipProvider>
				</div>
			</div>

			<div className="rounded-xl border border-border bg-card p-5 text-card-foreground">
				<div className="mb-4 flex items-end justify-between gap-3">
					<div>
						<h3 className="text-lg font-semibold">Confusion Matrix Heatmap</h3>
						<p className="text-xs text-muted-foreground">
							Rows = actual labels, columns = VLM predictions
						</p>
					</div>
				</div>

				{predictionMetrics.available ? (
					<div
						className={`ui-fade-opacity overflow-x-auto ${
							loadingBuildings ? "opacity-50" : "opacity-100"
						}`}
					>
						<table className="w-full min-w-[760px] text-sm">
							<thead>
								<tr className="border-b border-border/60 bg-muted/30 text-left text-muted-foreground">
									<th className="px-2 py-2 font-medium">Actual \ Predicted</th>
									{CONFUSION_LABELS.map((predictedLabel) => (
										<th
											key={`pred-${predictedLabel}`}
											className="px-2 py-2 text-center font-medium"
										>
											{prettyLabel(predictedLabel)}
										</th>
									))}
									<th className="px-2 py-2 text-center font-semibold text-foreground">
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
													predictionMetrics.confusionMatrix[actualLabel][
														predictedLabel
													] ?? 0;
												const isDiagonal = actualLabel === predictedLabel;

												return (
													<td
														key={`cell-${actualLabel}-${predictedLabel}`}
														className={`px-2 py-2 text-center font-medium ${
															isDiagonal
																? "text-emerald-900 dark:text-emerald-300"
																: "text-rose-700 dark:text-rose-300"
														}`}
														style={{
															backgroundColor: getCellBackgroundColor(
																actualLabel,
																predictedLabel,
																value,
																predictionMetrics.matrixMax,
															),
														}}
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
						No predicted VLM labels available yet to build the confusion matrix.
					</div>
				)}
			</div>
		</div>
	);
}
