import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant.tsx";
import MapMetricsPanel from "@/components/features/MapMetricsPanel.tsx";
import MapView from "@/components/features/MapView.tsx";
import { useXbdSelectorState } from "@/components/features/XbdSelector";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header.tsx";
import type { SceneMetrics } from "@/types/map";
import { getDisasterIdByName } from "@/utils/hazardlyApi.ts";

const DAMAGE_CLASS_ORDER = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
] as const;

const formatDamageLabel = (key: string): string =>
	key
		.replace(/_/g, " ")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c: string) => c.toUpperCase());

export default function MapPage() {
	const { disaster_name, xbdid } = useParams<{
		disaster_name: string;
		xbdid: string;
	}>();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const buildingFromUrl = searchParams.get("building")?.trim() ?? undefined;
	const normalizedDisasterParam = disaster_name?.trim();
	const requiresDisasterResolution = Boolean(normalizedDisasterParam);

	const [resolvedDisasterId, setResolvedDisasterId] = useState<number | null>(
		1,
	);
	const [isLoading, setIsLoading] = useState(requiresDisasterResolution);
	const [sceneMetrics, setSceneMetrics] = useState<SceneMetrics | null>(null);

	// 1. Validate XBD ID: If it's garbage text or missing, fallback to 18
	const normalizedXbdId = xbdid?.trim();
	const isXbdMissing = normalizedXbdId === undefined || normalizedXbdId === "";
	const isXbdMalformed = !isXbdMissing && !/^\d+$/.test(normalizedXbdId);
	const parsedXbdId =
		isXbdMissing || isXbdMalformed ? 18 : Number(normalizedXbdId);
	const [selectedXbdId, setSelectedXbdId] = useState(parsedXbdId);

	useEffect(() => {
		setSelectedXbdId(parsedXbdId);
	}, [parsedXbdId]);

	const hasRedirected = useRef(false);
	const lastRouteKey = useRef<string | null>(null);

	useEffect(() => {
		const routeKey = `${normalizedDisasterParam ?? ""}:${xbdid ?? ""}`;
		if (lastRouteKey.current !== routeKey) {
			hasRedirected.current = false;
			lastRouteKey.current = routeKey;
		}

		async function resolveDisaster() {
			if (hasRedirected.current) return;
			if (!requiresDisasterResolution) {
				setResolvedDisasterId(1);
				setIsLoading(false);
				return;
			}

			setIsLoading(true);
			try {
				let disasterId = 1;

				if (normalizedDisasterParam) {
					const id = await getDisasterIdByName(normalizedDisasterParam);

					if (!id) {
						hasRedirected.current = true;
						toast.error(
							`"${normalizedDisasterParam}" is not a valid disaster name.`,
							{ id: "disaster-not-found" },
						);
						navigate("/map", { replace: true });
						return;
					}
					disasterId = id;
				}

				if (isXbdMissing || isXbdMalformed) {
					if (normalizedDisasterParam || xbdid) {
						hasRedirected.current = true;

						if (isXbdMalformed) {
							toast.warning(`"${xbdid}" is not a valid scene ID.`, {
								id: "malformed-xbd",
							});
						} else if (normalizedDisasterParam) {
							toast.info(
								`No scene specified for ${normalizedDisasterParam}. Loading default view.`,
								{ id: "missing-xbd" },
							);
						}

						navigate("/map", { replace: true });
						return;
					}
				}

				setResolvedDisasterId(disasterId);
			} catch (_err) {
				if (!hasRedirected.current) {
					hasRedirected.current = true;
					toast.error("Critical error loading disaster data.", {
						id: "critical-error",
					});
					navigate("/map", { replace: true });
				}
			} finally {
				setIsLoading(false);
			}
		}

		void resolveDisaster();
	}, [
		normalizedDisasterParam,
		requiresDisasterResolution,
		xbdid,
		isXbdMissing,
		isXbdMalformed,
		navigate,
	]);

	const handleInvalidScene = useCallback(
		(message: string) => {
			toast.error(message);
			navigate("/map", { replace: true });
		},
		[navigate],
	);

	const disasterId = resolvedDisasterId ?? 1;
	const xbdSelector = useXbdSelectorState({
		disasterId,
		selectedXbdId,
		onChange: setSelectedXbdId,
	});

	if (
		requiresDisasterResolution &&
		(isLoading || resolvedDisasterId === null)
	) {
		return null;
	}

	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			<Header />
			<div className="flex-1 relative w-full max-w-[1700px] mx-auto px-4 md:px-6 py-4 min-h-[85vh]">
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-10">
					<div className="xl:col-span-7">
						<MapView
							key={`${disasterId}-${parsedXbdId}`}
							initialDisasterId={disasterId}
							selectedXbdId={selectedXbdId}
							onXbdChange={setSelectedXbdId}
							initialBuildingUid={buildingFromUrl}
							onSceneError={handleInvalidScene}
							onMetricsChange={setSceneMetrics}
							xbdSelectorStatus={xbdSelector.status}
							xbdIds={xbdSelector.xbdIds}
							canGoPrev={xbdSelector.canGoPrev}
							canGoNext={xbdSelector.canGoNext}
							onPrev={xbdSelector.goPrev}
							onNext={xbdSelector.goNext}
						/>
					</div>
					<div className="xl:col-span-3 h-[80vh]">
						<MapMetricsPanel
							metrics={sceneMetrics}
							isLoading={sceneMetrics === null}
							canGoPrev={xbdSelector.canGoPrev}
							canGoNext={xbdSelector.canGoNext}
							onPrev={xbdSelector.goPrev}
							onNext={xbdSelector.goNext}
							navDisabled={
								xbdSelector.status !== "ready" || sceneMetrics === null
							}
						/>
					</div>
				</div>

				<div className="mt-6 rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
					<div className="mb-3 flex items-center justify-between gap-2">
						<div>
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Confusion Matrix
							</p>
							<p className="text-[11px] text-muted-foreground">
								Rows = actual, columns = predicted
							</p>
						</div>
						<p className="text-[11px] text-muted-foreground">
							{sceneMetrics?.matrixTotal ?? 0} predictions compared
						</p>
					</div>

					{sceneMetrics && sceneMetrics.matrixTotal > 0 ? (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[720px] text-sm">
								<thead>
									<tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
										<th className="px-2 py-2 font-medium">Actual \\ Pred</th>
										{DAMAGE_CLASS_ORDER.map((predictedLabel) => (
											<th
												key={`scene-pred-${predictedLabel}`}
												className="px-2 py-2 font-medium text-center"
											>
												{formatDamageLabel(predictedLabel)}
											</th>
										))}
										<th className="px-2 py-2 font-semibold text-center text-foreground">
											Total
										</th>
									</tr>
								</thead>
								<tbody>
									{DAMAGE_CLASS_ORDER.map((actualLabel) => {
										const rowTotal = DAMAGE_CLASS_ORDER.reduce(
											(sum, predictedLabel) =>
												sum +
												(sceneMetrics.confusionMatrix[actualLabel]?.[
													predictedLabel
												] ?? 0),
											0,
										);

										return (
											<tr
												key={`scene-row-${actualLabel}`}
												className="border-b border-border/70"
											>
												<td className="px-2 py-2 font-medium">
													{formatDamageLabel(actualLabel)}
												</td>
												{DAMAGE_CLASS_ORDER.map((predictedLabel) => {
													const value =
														sceneMetrics.confusionMatrix[actualLabel]?.[
															predictedLabel
														] ?? 0;
													const isDiagonal = actualLabel === predictedLabel;
													const intensity =
														sceneMetrics.matrixMax > 0
															? value / sceneMetrics.matrixMax
															: 0;
													const baseAlpha = 0.12;
													const alpha =
														value > 0
															? baseAlpha + intensity * 0.6
															: 0.06;
													const backgroundColor = isDiagonal
														? `rgba(16, 185, 129, ${alpha})`
														: `rgba(239, 68, 68, ${alpha})`;

													return (
														<td
															key={`scene-cell-${actualLabel}-${predictedLabel}`}
															className={`px-2 py-2 text-center font-medium ${
																isDiagonal
																	? "text-emerald-700"
																	: "text-rose-700"
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
						<div className="rounded-md border border-border bg-background px-4 py-4 text-sm text-muted-foreground">
							No predicted labels available yet to build the confusion matrix.
						</div>
					)}
				</div>
			</div>
			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
