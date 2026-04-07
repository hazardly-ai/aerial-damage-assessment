import mapboxgl from "mapbox-gl";
import type Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";

import { BuildingPopup } from "@/components/features/BuildingPopup";
import { MapControls } from "@/components/features/MapControls";
import { MapLoadingOverlay } from "@/components/features/MapLoadingOverlay";
import { EXCLUDED_XBD_IDS } from "@/constants/excludedXbdIds";
import { useLoadingOverlay } from "@/hooks/useLoadingOverlay";
import type { MapStatus } from "@/types/map.ts";
import { BUILDINGS_SOURCE_ID } from "@/utils/addBuildingLayer";
import {
	fetchMapData,
	type ImageBounds,
	resolveImageUrl,
} from "@/utils/hazardlyApi";
import {
	addInitialSourcesAndLayers,
	bindBuildingInteractions,
	createCompareInstance,
	createMapInstance,
	POST_IMAGE_LAYER_ID,
	type PopupData,
	PRE_IMAGE_LAYER_ID,
	setBuildingVisibility,
	setImageryVisibility,
	setSatelliteOpacity,
	waitForMapsLoad,
} from "@/utils/mapViewSetup";

const DISASTER_ID = 1;
const XBD_ID = 18;
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);
	const compareIdleTimerRef = useRef<number | null>(null);
	const beforeMapRef = useRef<mapboxgl.Map | null>(null);
	const afterMapRef = useRef<mapboxgl.Map | null>(null);
	const layersReadyRef = useRef(false);

	const [disasterId, _setDisasterIdState] = useState<number>(() => {
		const saved = localStorage.getItem("lastDisasterId");
		return saved ? parseInt(saved, 10) : DISASTER_ID;
	});
	const [xbdId, setXbdIdState] = useState<number>(() => {
		const saved = localStorage.getItem("lastXbdId");
		const parsed = saved ? parseInt(saved, 10) : XBD_ID;
		const excluded = EXCLUDED_XBD_IDS[disasterId] || new Set();
		return excluded.has(parsed) ? XBD_ID : parsed;
	});
	const [sceneLoading, setSceneLoading] = useState(false);
	const [retryCount, setRetryCount] = useState(0);
	const [buildingsVisible, setBuildingsVisible] = useState(true);
	const [imageryVisible, setImageryVisible] = useState(true);
	const [compareIdle, setCompareIdle] = useState(false);
	const [status, setStatus] = useState<MapStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [popupData, setPopupData] = useState<PopupData | null>(null);
	const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(
		null,
	);

	const loadingOverlay = useLoadingOverlay(status);
	const popupDataRef = useRef<PopupData | null>(null);
	const selectedBuildingIdRef = useRef<string | number | null>(null);
	const imageryVisibleRef = useRef(imageryVisible);
	const boundsRef = useRef<ImageBounds | null>(null);
	const scheduleCompareIdleRef = useRef<() => void>(() => {});
	imageryVisibleRef.current = imageryVisible;

	const setXbdId = useCallback((newId: number) => {
		setXbdIdState(newId);
		localStorage.setItem("lastXbdId", newId.toString());
	}, []);

	const updatePopupPos = useCallback(() => {
		if (popupDataRef.current && afterMapRef.current) {
			const { x, y } = afterMapRef.current.project(popupDataRef.current.lngLat);
			setPopupPos({ x, y });
		}
	}, []);

	const scheduleCompareIdle = useCallback(() => {
		if (compareIdleTimerRef.current !== null) {
			window.clearTimeout(compareIdleTimerRef.current);
		}
		setCompareIdle(false);
		compareIdleTimerRef.current = window.setTimeout(() => {
			setCompareIdle(true);
		}, 2000);
	}, []);
	scheduleCompareIdleRef.current = scheduleCompareIdle;

	const closePopup = useCallback(() => {
		const id = selectedBuildingIdRef.current;
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (id !== null && before && after) {
			before.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id },
				{ selected: false },
			);
			after.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id },
				{ selected: false },
			);
		}
		selectedBuildingIdRef.current = null;
		popupDataRef.current = null;
		setPopupData(null);
		setPopupPos(null);
	}, []);

	const openPopup = useCallback(
		(data: PopupData) => {
			popupDataRef.current = data;
			setPopupData(data);
			updatePopupPos();
		},
		[updatePopupPos],
	);

	const handleToggle = useCallback(() => {
		closePopup();
		setBuildingsVisible((prev) => {
			const next = !prev;
			if (
				layersReadyRef.current &&
				beforeMapRef.current &&
				afterMapRef.current
			) {
				setBuildingVisibility(beforeMapRef.current, next);
				setBuildingVisibility(afterMapRef.current, next);
			}
			return next;
		});
	}, [closePopup]);

	const handleImageryToggle = useCallback(() => {
		setImageryVisible((prev) => {
			const next = !prev;
			if (
				layersReadyRef.current &&
				beforeMapRef.current &&
				afterMapRef.current
			) {
				setImageryVisibility(beforeMapRef.current, PRE_IMAGE_LAYER_ID, next);
				setImageryVisibility(afterMapRef.current, POST_IMAGE_LAYER_ID, next);
				setSatelliteOpacity(beforeMapRef.current, next);
				setSatelliteOpacity(afterMapRef.current, next);
			}
			return next;
		});
	}, []);

	const handleResetView = useCallback(() => {
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		const bounds = boundsRef.current;
		if (!before || !after || !bounds) return;

		before.fitBounds([bounds.sw, bounds.ne], { padding: 0, animate: true });
		after.fitBounds([bounds.sw, bounds.ne], { padding: 0, animate: true });
	}, []);

	const xbdIdRef = useRef(xbdId);
	xbdIdRef.current = xbdId;

	useEffect(() => {
		if (!containerRef.current) return;

		let cancelled = false;
		const abortController = new AbortController();
		let beforeMap: mapboxgl.Map | null = null;
		let afterMap: mapboxgl.Map | null = null;

		void retryCount;

		setStatus("loading");
		setErrorMessage(null);

		fetchMapData(disasterId, xbdIdRef.current, {
			signal: abortController.signal,
		})
			.then(({ imagePair, buildings, bounds }) => {
				if (cancelled || !containerRef.current) return;
				boundsRef.current = bounds;

				containerRef.current.innerHTML = "";
				const beforeDiv = document.createElement("div");
				const afterDiv = document.createElement("div");
				Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
				Object.assign(afterDiv.style, { position: "absolute", inset: "0" });
				containerRef.current.appendChild(beforeDiv);
				containerRef.current.appendChild(afterDiv);

				beforeMap = createMapInstance(beforeDiv, imageryVisibleRef, {
					withResetBoundsControl: true,
					onResetView: handleResetView,
				});
				beforeMapRef.current = beforeMap;
				afterMap = createMapInstance(afterDiv, imageryVisibleRef, {
					withResetBoundsControl: true,
					onResetView: handleResetView,
				});
				afterMapRef.current = afterMap;

				const { coordinates, sw, ne } = bounds;
				const preImageUrl = resolveImageUrl(
					imagePair.properties.pre_image_path,
				);
				const postImageUrl = resolveImageUrl(
					imagePair.properties.post_image_path,
				);

				const _before = beforeMap;
				const _after = afterMap;

				const onMapsLoaded = () => {
					if (cancelled) return;

					addInitialSourcesAndLayers({
						beforeMap: _before,
						afterMap: _after,
						preImageUrl,
						postImageUrl,
						coordinates,
						buildings,
					});

					layersReadyRef.current = true;
					setBuildingsVisible((current) => {
						setBuildingVisibility(_before, current);
						setBuildingVisibility(_after, current);
						return current;
					});
					setImageryVisible((current) => {
						setImageryVisibility(_before, PRE_IMAGE_LAYER_ID, current);
						setImageryVisibility(_after, POST_IMAGE_LAYER_ID, current);
						setSatelliteOpacity(_before, current);
						setSatelliteOpacity(_after, current);
						return current;
					});

					setStatus("ready");
					bindBuildingInteractions({
						beforeMap: _before,
						afterMap: _after,
						onPopupOpen: openPopup,
						onPopupPositionUpdate: updatePopupPos,
						selectedBuildingIdRef,
					});

					if (containerRef.current) {
						compareRef.current = createCompareInstance({
							beforeMap: _before,
							afterMap: _after,
							container: containerRef.current,
						});
						scheduleCompareIdleRef.current();
					}

					_before.fitBounds([sw, ne], { padding: 0, animate: false });
				};

				waitForMapsLoad(_before, _after).then(onMapsLoaded);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				if (err instanceof DOMException && err.name === "AbortError") return;
				const msg =
					err instanceof Error
						? err.message
						: "Unknown error fetching map data.";
				setErrorMessage(msg);
				setStatus("error");
			});

		return () => {
			cancelled = true;
			abortController.abort();
			if (compareIdleTimerRef.current !== null) {
				window.clearTimeout(compareIdleTimerRef.current);
				compareIdleTimerRef.current = null;
			}
			selectedBuildingIdRef.current = null;
			boundsRef.current = null;
			layersReadyRef.current = false;
			compareRef.current?.remove();
			beforeMap?.remove();
			afterMap?.remove();
			beforeMapRef.current = null;
			afterMapRef.current = null;
		};
		// xbdId is intentionally excluded; scene switches are handled by Effect 2.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openPopup, updatePopupPos, retryCount, handleResetView, disasterId]);

	useEffect(() => {
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (!before || !after || !layersReadyRef.current) return;

		let cancelled = false;
		const abortController = new AbortController();
		setSceneLoading(true);
		closePopup();

		fetchMapData(disasterId, xbdId, { signal: abortController.signal })
			.then(({ imagePair, buildings, bounds }) => {
				if (cancelled || !beforeMapRef.current || !afterMapRef.current) return;
				boundsRef.current = bounds;

				const _before = beforeMapRef.current;
				const _after = afterMapRef.current;
				const preImageUrl = resolveImageUrl(
					imagePair.properties.pre_image_path,
				);
				const postImageUrl = resolveImageUrl(
					imagePair.properties.post_image_path,
				);
				const { coordinates, sw, ne } = bounds;

				(_before.getSource("pre-image") as mapboxgl.ImageSource).updateImage({
					url: preImageUrl,
					coordinates,
				});
				(_after.getSource("post-image") as mapboxgl.ImageSource).updateImage({
					url: postImageUrl,
					coordinates,
				});

				selectedBuildingIdRef.current = null;
				popupDataRef.current = null;
				setPopupData(null);
				setPopupPos(null);

				const beforeSource = _before.getSource(
					BUILDINGS_SOURCE_ID,
				) as mapboxgl.GeoJSONSource;
				const afterSource = _after.getSource(
					BUILDINGS_SOURCE_ID,
				) as mapboxgl.GeoJSONSource;

				beforeSource.setData({ type: "FeatureCollection", features: [] });
				afterSource.setData({ type: "FeatureCollection", features: [] });
				beforeSource.setData(buildings);
				afterSource.setData(buildings);

				_before.fitBounds([sw, ne], { padding: 0, animate: true });
				setSceneLoading(false);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				if (err instanceof DOMException && err.name === "AbortError") return;
				const msg =
					err instanceof Error ? err.message : "Failed to load scene.";
				setErrorMessage(msg);
				setStatus("error");
				setSceneLoading(false);
			});

		return () => {
			cancelled = true;
			abortController.abort();
		};
	}, [xbdId, closePopup, disasterId]);

	useEffect(() => {
		if (!imageryVisible) {
			if (compareIdleTimerRef.current !== null) {
				window.clearTimeout(compareIdleTimerRef.current);
				compareIdleTimerRef.current = null;
			}
			setCompareIdle(false);
			return;
		}

		scheduleCompareIdle();
		const container = containerRef.current;
		if (!container) return;

		const handleActivity = () => {
			scheduleCompareIdle();
		};

		container.addEventListener("pointerdown", handleActivity);
		container.addEventListener("pointermove", handleActivity);
		container.addEventListener("touchstart", handleActivity);

		return () => {
			container.removeEventListener("pointerdown", handleActivity);
			container.removeEventListener("pointermove", handleActivity);
			container.removeEventListener("touchstart", handleActivity);
		};
	}, [imageryVisible, scheduleCompareIdle]);

	return (
		<div
			className={`map-wrapper${compareIdle ? " map-wrapper--compare-idle" : ""}`}
			data-imagery-visible={imageryVisible ? "true" : "false"}
			data-compare-idle={compareIdle ? "true" : "false"}
		>
			<div ref={containerRef} className="map-container" />

			<MapControls
				disasterId={disasterId}
				selectedXbdId={xbdId}
				onXbdChange={setXbdId}
				sceneDisabled={status !== "ready"}
				sceneLoading={sceneLoading}
				imageryVisible={imageryVisible}
				onImageryToggle={handleImageryToggle}
				buildingsVisible={buildingsVisible}
				onBuildingsToggle={handleToggle}
				visible={status === "ready"}
			/>

			<MapLoadingOverlay {...loadingOverlay} />

			{status === "error" && errorMessage && (
				<div
					className="map-status-overlay map-status-overlay--error"
					role="alert"
				>
					<p>
						<strong>Failed to load map.</strong>
					</p>
					<p>{errorMessage}</p>
					<button
						type="button"
						onClick={() => {
							setStatus("loading");
							setErrorMessage(null);
							setRetryCount((c) => c + 1);
						}}
					>
						Retry
					</button>
				</div>
			)}

			{popupData && popupPos && (
				<div
					className="popup-overlay"
					style={{ left: popupPos.x, top: popupPos.y }}
				>
					<BuildingPopup
						uid={popupData.uid}
						damage={popupData.damage}
						damageColor={popupData.damageColor}
						onClose={closePopup}
					/>
				</div>
			)}
		</div>
	);
}
