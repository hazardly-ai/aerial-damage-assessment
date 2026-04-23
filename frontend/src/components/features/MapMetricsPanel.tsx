import { DAMAGE_COLOR_HEX } from "@/constants/app";
import type { SceneMetrics } from "@/types/map";

interface MapMetricsPanelProps {
	metrics: SceneMetrics | null;
	isLoading?: boolean;
}

const formatDamageLabel = (key: string): string =>
	key
		.replace(/_/g, " ")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c: string) => c.toUpperCase());

const formatPercent = (value: number): string => `${Math.round(value)}%`;
const formatAccuracyPercent = (value: number): string => `${value.toFixed(1)}%`;

const DAMAGE_CLASS_ORDER = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
] as const;

export default function MapMetricsPanel({
	metrics,
	isLoading = false,
}: MapMetricsPanelProps) {
	if (isLoading || !metrics) {
		return (
			<aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm">
				<div className="animate-pulse space-y-3">
					<div className="h-5 w-32 rounded bg-muted" />
					<div className="grid grid-cols-2 gap-3">
						<div className="h-20 rounded-xl bg-muted" />
						<div className="h-20 rounded-xl bg-muted" />
					</div>
					<div className="space-y-2">
						<div className="h-10 rounded-xl bg-muted" />
						<div className="h-10 rounded-xl bg-muted" />
						<div className="h-10 rounded-xl bg-muted" />
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
		<aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur-sm">
			<div className="mb-4 flex items-center justify-between">
				<div>
					<p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
						Image Metrics
					</p>
					<h3 className="text-lg font-semibold text-foreground">
						Scene #{metrics.xbdId}
					</h3>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div className="rounded-xl border border-border/60 bg-background/70 p-3">
					<p className="text-xs text-muted-foreground">Total Buildings</p>
					<p className="mt-1 text-2xl font-bold text-foreground">
						{metrics.totalBuildings.toLocaleString()}
					</p>
				</div>

				<div className="rounded-xl border border-border/60 bg-background/70 p-3">
					<p className="text-xs text-muted-foreground">Accuracy</p>
					<p className="mt-1 text-2xl font-bold text-foreground">
						{metrics.accuracy !== null
							? formatAccuracyPercent(metrics.accuracy)
							: "N/A"}
					</p>
				</div>
			</div>

			<div className="mt-4 min-h-[190px] flex-1 rounded-xl border border-border/60 bg-background/70 p-3">
				<div className="mb-2 flex items-center justify-between gap-2">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
				<div className="space-y-3">
					{damageEntries.map((row) => {
						return (
							<div key={row.label} className="space-y-1">
								<div className="flex items-center justify-between text-xs">
									<span className="font-medium text-foreground">
										{formatDamageLabel(row.label)}
									</span>
									<span className="text-[11px] text-muted-foreground">
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
		</aside>
	);
}
