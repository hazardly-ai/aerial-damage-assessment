import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import MapMetricsPanel from "@/components/features/MapMetricsPanel.tsx";
import MapView from "@/components/features/MapView.tsx";
import { useXbdSelectorState } from "@/components/features/XbdSelector";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header.tsx";
import { SpinnerEmpty } from "@/components/ui/SpinnerEmpty";
import type { ChatMapCommand } from "@/types/chat";
import type { SceneMetrics } from "@/types/map";
import { getDisasterIdByName } from "@/utils/hazardlyApi.ts";

interface MapPageProps {
	chatCommand?: ChatMapCommand | null;
}

export default function MapPage({ chatCommand = null }: MapPageProps) {
	const { disaster_name, xbdid } = useParams<{
		disaster_name: string;
		xbdid: string;
	}>();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const suppressMissingSceneToast = false;
	const buildingFromUrl = searchParams.get("building")?.trim() ?? undefined;
	const normalizedDisasterParam = disaster_name?.trim();
	const requiresDisasterResolution = Boolean(normalizedDisasterParam);
	const disasterFallbackPath = normalizedDisasterParam
		? `/map/${normalizedDisasterParam}`
		: "/map";

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
						if (isXbdMalformed) {
							hasRedirected.current = true;
							setResolvedDisasterId(disasterId);
							toast.warning(`"${xbdid}" is not a valid scene ID.`, {
								id: "malformed-xbd",
							});
							navigate(disasterFallbackPath, { replace: true });
							return;
						} else if (normalizedDisasterParam && !suppressMissingSceneToast) {
							toast.info(
								`No scene specified for ${normalizedDisasterParam}. Loading default view.`,
								{ id: "missing-xbd" },
							);
						}
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
		disasterFallbackPath,
		navigate,
	]);

	const handleInvalidScene = useCallback(
		(message: string) => {
			toast.error(message);
			navigate(disasterFallbackPath, {
				replace: true,
			});
		},
		[disasterFallbackPath, navigate],
	);

	useEffect(() => {
		if (chatCommand?.targetXbdId && chatCommand.targetXbdId !== selectedXbdId) {
			setSelectedXbdId(chatCommand.targetXbdId);
		}
	}, [chatCommand, selectedXbdId]);

	const disasterId = resolvedDisasterId ?? 1;
	const xbdSelector = useXbdSelectorState({
		disasterId,
		selectedXbdId,
		onChange: setSelectedXbdId,
		allowFallbackSelection: isXbdMissing,
	});

	if (
		requiresDisasterResolution &&
		(isLoading || resolvedDisasterId === null)
	) {
		return (
			<div className="flex min-h-screen flex-col bg-background text-foreground">
				<Header />
				<div className="flex flex-1 items-center justify-center px-4">
					<SpinnerEmpty
						title="Loading Map"
						description="Resolving the requested disaster and scene..."
						className="border-0"
					/>
				</div>
				<Footer />
			</div>
		);
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
							chatCommand={chatCommand}
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
			</div>
			<Footer />
		</div>
	);
}
