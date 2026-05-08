import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAMAGE_COLOR_HEX } from "@/constants/app";
import { prettyLabel } from "@/pages/dashboard/dashboardUtils";
import type { SceneMetrics } from "@/types/map";

interface MapMetricsPanelProps {
	metrics: SceneMetrics | null;
	isLoading?: boolean;
	canGoPrev?: boolean;
	canGoNext?: boolean;
	onPrev?: () => void;
	onNext?: () => void;
	navDisabled?: boolean;
}

const formatDamageLabel = (key: string): string =>
	key
		.replace(/_/g, " ")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c: string) => c.toUpperCase());

const formatPercent = (value: number): string => `${Math.round(value)}%`;
const formatAccuracyPercent = (value: number): string => `${value.toFixed(1)}%`;
const formatMetricPercent = (value: number | null): string =>
	value === null ? "N/A" : `${value.toFixed(1)}%`;

const DAMAGE_CLASS_ORDER = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
] as const;

const getCellBackgroundColor = (
	actualLabel: string,
	predictedLabel: string,
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

export default function MapMetricsPanel({
	metrics,
	isLoading = false,
	canGoPrev = false,
	canGoNext = false,
	onPrev,
	onNext,
	navDisabled = false,
}: MapMetricsPanelProps) {
	if (isLoading || !metrics) {
		return (
			<aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm">
				<div className="animate-pulse space-y-2.5">
					<div className="h-4 w-28 rounded bg-muted" />
					<div className="grid grid-cols-2 gap-2">
						<div className="h-16 rounded-lg bg-muted" />
						<div className="h-16 rounded-lg bg-muted" />
					</div>
					<div className="grid grid-cols-3 gap-2">
						<div className="h-14 rounded-lg bg-muted" />
						<div className="h-14 rounded-lg bg-muted" />
						<div className="h-14 rounded-lg bg-muted" />
					</div>
					<div className="space-y-2">
						<div className="h-20 rounded-lg bg-muted" />
						<div className="h-32 rounded-lg bg-muted" />
					</div>
				</div>
			</aside>
		);
	}

	const predictedTotal = DAMAGE_CLASS_ORDER.reduce(
		(total, label) => total + (metrics.damageDistribution[label] ?? 0),
		0,
	);
	const actualTotal = DAMAGE_CLASS_ORDER.reduce(
		(total, label) => total + (metrics.actualDamageDistribution[label] ?? 0),
		0,
	);

	const damageEntries = DAMAGE_CLASS_ORDER.map((label) => {
		const predictedCount = metrics.damageDistribution[label] ?? 0;
		const actualCount = metrics.actualDamageDistribution[label] ?? 0;
		const predictedPercentage =
			predictedTotal > 0 ? (predictedCount / predictedTotal) * 100 : 0;
		const actualPercentage =
			actualTotal > 0 ? (actualCount / actualTotal) * 100 : 0;

		return {
			label,
			predictedCount,
			actualCount,
			predictedPercentage,
			actualPercentage,
		};
	});

	return (
		<aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm backdrop-blur-sm">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
						Image Metrics
					</p>
					<h3 className="text-base font-semibold text-foreground">
						Scene #{metrics.xbdId}
					</h3>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
						onClick={onPrev}
						disabled={navDisabled || !canGoPrev}
						aria-label="Previous scene"
					>
						<ChevronLeft size={14} />
					</button>
					<button
						type="button"
						className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
						onClick={onNext}
						disabled={navDisabled || !canGoNext}
						aria-label="Next scene"
					>
						<ChevronRight size={14} />
					</button>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
					<p className="text-[11px] text-muted-foreground">Total Buildings</p>
					<p className="mt-1 text-xl font-bold text-foreground">
						{metrics.totalBuildings.toLocaleString()}
					</p>
				</div>

				<div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
					<p className="text-[11px] text-muted-foreground">Accuracy</p>
					<p className="mt-1 text-xl font-bold text-foreground">
						{metrics.accuracy !== null
							? formatAccuracyPercent(metrics.accuracy)
							: "N/A"}
					</p>
				</div>
			</div>

			<div className="mt-2 grid grid-cols-3 gap-2">
				<div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
					<p className="text-[11px] text-muted-foreground">Precision</p>
					<p className="mt-1 text-lg font-semibold text-foreground">
						{formatMetricPercent(metrics.precisionMacro)}
					</p>
				</div>
				<div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
					<p className="text-[11px] text-muted-foreground">Recall</p>
					<p className="mt-1 text-lg font-semibold text-foreground">
						{formatMetricPercent(metrics.recallMacro)}
					</p>
				</div>
				<div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
					<p className="text-[11px] text-muted-foreground">F1</p>
					<p className="mt-1 text-lg font-semibold text-foreground">
						{formatMetricPercent(metrics.f1Macro)}
					</p>
				</div>
			</div>

			<div className="mt-2 rounded-lg border border-border/60 bg-background/70 p-2.5">
				<div className="mb-2 flex items-center justify-between gap-2">
					<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Damage Distribution
					</p>
					<div className="inline-flex items-center gap-3 text-[11px] text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<span
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: "#2563eb", opacity: 0.9 }}
							/>
							Predicted
						</span>
					</div>
				</div>
				<div className="space-y-2">
					{damageEntries.map((row) => {
						return (
							<div key={row.label} className="space-y-1">
								<div className="flex items-center justify-between gap-2 text-[11px]">
									<span className="font-medium text-foreground">
										{formatDamageLabel(row.label)}
									</span>
									<span className="text-[10px] text-muted-foreground">
										A: {row.actualCount} ({formatPercent(row.actualPercentage)})
										| P: {row.predictedCount} (
										{formatPercent(row.predictedPercentage)})
									</span>
								</div>
								<div className="h-1.5 w-full rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-primary"
										style={{
											width: `${row.actualPercentage}%`,
											backgroundColor: DAMAGE_COLOR_HEX[row.label],
											opacity: 0.8,
										}}
									/>
								</div>
								<div className="h-1.5 w-full rounded-full bg-muted">
									<div
										className="h-full rounded-full"
										style={{
											width: `${row.predictedPercentage}%`,
											backgroundColor: "#2563eb",
											opacity: 0.9,
										}}
									/>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			<div className="mt-2 flex-1 rounded-lg border border-border/60 bg-background/70 p-2.5">
				<div className="mb-2 flex items-center justify-between gap-2">
					<div>
						<p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							Confusion Matrix
						</p>
						<p className="text-[10px] text-muted-foreground">
							Rows = actual, columns = predicted
						</p>
					</div>
					<p className="text-[10px] text-muted-foreground">
						{metrics.matrixTotal} predictions compared
					</p>
				</div>

				{metrics.matrixTotal > 0 ? (
					<div className="overflow-hidden">
						<table className="w-full table-fixed text-xs">
							<thead>
								<tr className="border-b border-border/60 bg-muted/30 text-left text-muted-foreground">
									<th className="w-[24%] px-1.5 py-1.5 font-medium">
										Actual \ Pred
									</th>
									{DAMAGE_CLASS_ORDER.map((predictedLabel) => (
										<th
											key={`scene-pred-${predictedLabel}`}
											className="px-1 py-1.5 text-center font-medium"
										>
											<span className="block leading-tight">
												{prettyLabel(predictedLabel)}
											</span>
										</th>
									))}
									<th className="px-1 py-1.5 text-center font-semibold text-foreground">
										Total
									</th>
								</tr>
							</thead>
							<tbody>
								{DAMAGE_CLASS_ORDER.map((actualLabel) => {
									const rowTotal = DAMAGE_CLASS_ORDER.reduce(
										(sum, predictedLabel) =>
											sum +
											(metrics.confusionMatrix[actualLabel]?.[predictedLabel] ??
												0),
										0,
									);

									return (
										<tr
											key={`scene-row-${actualLabel}`}
											className="border-b border-border/70"
										>
											<td className="px-1.5 py-1.5 font-medium leading-tight">
												{prettyLabel(actualLabel)}
											</td>
											{DAMAGE_CLASS_ORDER.map((predictedLabel) => {
												const value =
													metrics.confusionMatrix[actualLabel]?.[
														predictedLabel
													] ?? 0;
												const isDiagonal = actualLabel === predictedLabel;

												return (
													<td
														key={`scene-cell-${actualLabel}-${predictedLabel}`}
														className={`px-1 py-1.5 text-center font-medium ${
															isDiagonal
																? "text-emerald-900 dark:text-emerald-300"
																: "text-rose-700 dark:text-rose-300"
														}`}
														style={{
															backgroundColor: getCellBackgroundColor(
																actualLabel,
																predictedLabel,
																value,
																metrics.matrixMax,
															),
														}}
													>
														{value}
													</td>
												);
											})}
											<td className="px-1 py-1.5 text-center font-semibold text-muted-foreground">
												{rowTotal}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : (
					<div className="rounded-md border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
						No predicted labels available yet to build the confusion matrix.
					</div>
				)}
			</div>
		</aside>
	);
}
