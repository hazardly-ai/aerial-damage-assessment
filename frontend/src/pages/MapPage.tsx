import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant.tsx";
import MapView from "@/components/features/MapView.tsx";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header.tsx";
import { getDisasterIdByName } from "@/utils/hazardlyApi.ts";

export default function MapPage() {
	const { disaster_name, xbdid } = useParams<{
		disaster_name: string;
		xbdid: string;
	}>();
	const navigate = useNavigate();

	const [resolvedDisasterId, setResolvedDisasterId] = useState<number | null>(
		null,
	);
	const [isLoading, setIsLoading] = useState(true);

	// 1. Validate XBD ID: If it's garbage text or missing, fallback to 18
	const isXbdMissing = xbdid === undefined || xbdid.trim() === "";
	const isXbdMalformed =
		!isXbdMissing && Number.isNaN(Number.parseInt(xbdid, 10));
	const parsedXbdId =
		isXbdMissing || isXbdMalformed ? 18 : Number.parseInt(xbdid, 10);

	const hasRedirected = useRef(false);

	useEffect(() => {
		hasRedirected.current = false;
	}, []);

	useEffect(() => {
		async function resolveDisaster() {
			if (hasRedirected.current) return;

			setIsLoading(true);
			try {
				let disasterId = 1;

				if (disaster_name) {
					const id = await getDisasterIdByName(disaster_name);

					if (!id) {
						hasRedirected.current = true;
						// Adding a unique ID prevents duplicates
						toast.error(`Disaster "${disaster_name}" not recognized.`, {
							id: "disaster-not-found",
						});
						navigate("/map", { replace: true });
						return;
					}
					disasterId = id;
				}

				if (isXbdMissing || isXbdMalformed) {
					if (disaster_name || xbdid) {
						hasRedirected.current = true;

						if (isXbdMalformed) {
							toast.warning(`"${xbdid}" is not a valid scene ID.`, {
								id: "malformed-xbd",
							});
						} else if (disaster_name) {
							toast.info(
								`No scene specified for ${disaster_name}. Loading default view.`,
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
	}, [disaster_name, xbdid, isXbdMissing, isXbdMalformed, navigate]);

	if (isLoading || resolvedDisasterId === null) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="animate-pulse text-lg">Verifying location...</div>
			</div>
		);
	}

	const handleInvalidScene = (message: string) => {
		toast.error(message);
		navigate("/map", { replace: true });
	};

	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			<Header />
			<div className="flex-1 relative w-full max-w-[1600px] mx-auto px-6 py-4 min-h-[75vh]">
				<MapView
					key={`${resolvedDisasterId}-${parsedXbdId}`}
					initialDisasterId={resolvedDisasterId}
					initialXbdId={parsedXbdId}
					onSceneError={handleInvalidScene}
				/>
			</div>
			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
