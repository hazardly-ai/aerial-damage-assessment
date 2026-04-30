import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant.tsx";
import MapMetricsPanel from "@/components/features/MapMetricsPanel.tsx";
import MapView from "@/components/features/MapView.tsx";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header.tsx";
import type { SceneMetrics } from "@/types/map";
import { getDisasterIdByName } from "@/utils/hazardlyApi.ts";

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

	const hasRedirected = useRef(false);

	useEffect(() => {
		hasRedirected.current = false;
	}, []);

	useEffect(() => {
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

	if (
		requiresDisasterResolution &&
		(isLoading || resolvedDisasterId === null)
	) {
		return null;
	}

	const disasterId = resolvedDisasterId ?? 1;

	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			<Header />
			<div className="flex-1 relative w-full max-w-[1700px] mx-auto px-4 md:px-6 py-4 min-h-[75vh]">
				<div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-10">
					<div className="xl:col-span-7">
						<MapView
							key={`${disasterId}-${parsedXbdId}`}
							initialDisasterId={disasterId}
							initialXbdId={parsedXbdId}
							initialBuildingUid={buildingFromUrl}
							onSceneError={handleInvalidScene}
							onMetricsChange={setSceneMetrics}
						/>
					</div>
					<div className="xl:col-span-3 h-[70vh]">
						<MapMetricsPanel
							metrics={sceneMetrics}
							isLoading={sceneMetrics === null}
						/>
					</div>
				</div>
			</div>
			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
