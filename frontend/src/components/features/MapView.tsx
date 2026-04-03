import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";
import type { Feature } from "geojson";

import { BuildingPopup } from "@/components/features/BuildingPopup";
import { MapControls } from "@/components/features/MapControls";
import { MapLoadingOverlay } from "@/components/features/MapLoadingOverlay";
import { useLoadingOverlay } from "@/hooks/useLoadingOverlay";
import type { MapStatus } from "@/types/map.ts";
import {
	addBuildingLayer,
	BUILDINGS_FILL_LAYER_ID,
	BUILDINGS_OUTLINE_LAYER_ID,
	BUILDINGS_SOURCE_ID,
	getBuildingDamageColor,
} from "@/utils/addBuildingLayer";
import { fetchMapData, resolveImageUrl } from "@/utils/hazardlyApi";

const DISASTER_ID = 1;
const XBD_ID = 18;
const PRE_IMAGE_LAYER_ID = "pre-layer";
const POST_IMAGE_LAYER_ID = "post-layer";
const SATELLITE_BASE_LAYER_ID = "satellite";
const SATELLITE_DIMMED_OPACITY = 0.4;
const SATELLITE_FULL_OPACITY = 1;

interface PopupData {
	uid: string;
	damage?: string;
	damageColor: string;
	lngLat: mapboxgl.LngLat;
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const setBuildingVisibility = (map: mapboxgl.Map, visible: boolean) => {
	const visibility = visible ? "visible" : "none";
	map.setLayoutProperty(BUILDINGS_FILL_LAYER_ID, "visibility", visibility);
	map.setLayoutProperty(BUILDINGS_OUTLINE_LAYER_ID, "visibility", visibility);
};

const setImageryVisibility = (
	map: mapboxgl.Map,
	layerId: string,
	visible: boolean,
) => {
	map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
};

const setSatelliteOpacity = (map: mapboxgl.Map, imageryVisible: boolean) => {
	map.setPaintProperty(
		SATELLITE_BASE_LAYER_ID,
		"raster-opacity",
		imageryVisible ? SATELLITE_DIMMED_OPACITY : SATELLITE_FULL_OPACITY,
	);
};

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);
	const beforeMapRef = useRef<mapboxgl.Map | null>(null);
	const afterMapRef = useRef<mapboxgl.Map | null>(null);
	const layersReadyRef = useRef(false);

	const [xbdId, setXbdId] = useState<number>(XBD_ID);
	const [sceneLoading, setSceneLoading] = useState(false);
	const [retryCount, setRetryCount] = useState(0);
	const [buildingsVisible, setBuildingsVisible] = useState(true);
	const [imageryVisible, setImageryVisible] = useState(true);
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
	imageryVisibleRef.current = imageryVisible;

	const updatePopupPos = useCallback(() => {
		if (popupDataRef.current && afterMapRef.current) {
			const { x, y } = afterMapRef.current.project(popupDataRef.current.lngLat);
			setPopupPos({ x, y });
		}
	}, []);

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

		fetchMapData(DISASTER_ID, xbdIdRef.current, {
			signal: abortController.signal,
		})
			.then(({ imagePair, buildings, bounds }) => {
				if (cancelled || !containerRef.current) return;

				containerRef.current.innerHTML = "";
				const beforeDiv = document.createElement("div");
				const afterDiv = document.createElement("div");
				Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
				Object.assign(afterDiv.style, { position: "absolute", inset: "0" });
				containerRef.current.appendChild(beforeDiv);
				containerRef.current.appendChild(afterDiv);

				const createMap = (container: HTMLElement) => {
					const map = new mapboxgl.Map({
						container,
						style: "mapbox://styles/mapbox/satellite-v9",
						renderWorldCopies: false,
					});
					map.on("style.load", () =>
						setSatelliteOpacity(map, imageryVisibleRef.current),
					);
					map.on("error", (e) => console.error("Mapbox error:", e));
					map.addControl(new mapboxgl.NavigationControl(), "top-right");
					return map;
				};

				beforeMap = createMap(beforeDiv);
				beforeMapRef.current = beforeMap;
				afterMap = createMap(afterDiv);
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

					_before.addSource("pre-image", {
						type: "image",
						url: preImageUrl,
						coordinates,
					});
					_before.addLayer({
						id: PRE_IMAGE_LAYER_ID,
						type: "raster",
						source: "pre-image",
					});
					_after.addSource("post-image", {
						type: "image",
						url: postImageUrl,
						coordinates,
					});
					_after.addLayer({
						id: POST_IMAGE_LAYER_ID,
						type: "raster",
						source: "post-image",
					});

					addBuildingLayer(_before, buildings);
					addBuildingLayer(_after, buildings);

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
					_after.on("move", updatePopupPos);

					let hoveredId: string | number | null = null;

					const setHoverOnBoth = (id: string | number, hover: boolean) => {
						_before.setFeatureState(
							{ source: BUILDINGS_SOURCE_ID, id },
							{ hover },
						);
						_after.setFeatureState(
							{ source: BUILDINGS_SOURCE_ID, id },
							{ hover },
						);
					};

					const clearHover = () => {
						if (hoveredId === null) return;
						setHoverOnBoth(hoveredId, false);
						hoveredId = null;
					};

					const bindHover = (activeMap: mapboxgl.Map) => {
						activeMap.on("mousemove", BUILDINGS_FILL_LAYER_ID, (e) => {
							const feature = e.features?.[0];
							if (
								!feature ||
								(typeof feature.id !== "string" &&
									typeof feature.id !== "number")
							) {
								return;
							}

							activeMap.getCanvas().style.cursor = "pointer";
							const next = feature.id;
							if (hoveredId === next) return;
							if (hoveredId !== null) setHoverOnBoth(hoveredId, false);
							hoveredId = next;
							setHoverOnBoth(next, true);
						});
						activeMap.on("mouseleave", BUILDINGS_FILL_LAYER_ID, () => {
							activeMap.getCanvas().style.cursor = "";
							clearHover();
						});
					};

					bindHover(_before);
					bindHover(_after);

					const handleBuildingClick = (
						e: mapboxgl.MapMouseEvent & { features?: Feature[] },
					) => {
						const feature = e.features?.[0];
						if (
							!feature ||
							(typeof feature.id !== "string" && typeof feature.id !== "number")
						) {
							return;
						}

						const uid = asString(feature.properties?.uid);
						if (!uid) return;

						const featureId = feature.id;
						const prev = selectedBuildingIdRef.current;
						if (prev !== null && prev !== featureId) {
							_before.setFeatureState(
								{ source: BUILDINGS_SOURCE_ID, id: prev },
								{ selected: false },
							);
							_after.setFeatureState(
								{ source: BUILDINGS_SOURCE_ID, id: prev },
								{ selected: false },
							);
						}

						selectedBuildingIdRef.current = featureId;
						_before.setFeatureState(
							{ source: BUILDINGS_SOURCE_ID, id: featureId },
							{ selected: true },
						);
						_after.setFeatureState(
							{ source: BUILDINGS_SOURCE_ID, id: featureId },
							{ selected: true },
						);

						const damage = asString(feature.properties?.predicted_damage);
						const damageColor = getBuildingDamageColor(damage);
						openPopup({ uid, damage, damageColor, lngLat: e.lngLat });
					};

					_before.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);
					_after.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);

					if (containerRef.current) {
						compareRef.current = new Compare(
							_before,
							_after,
							containerRef.current,
						);
						(
							compareRef.current as Compare & {
								_mapB: mapboxgl.Map;
								_getX: (e: MouseEvent | TouchEvent) => number;
							}
						)._getX = function (e) {
							const touch = (e as TouchEvent).touches;
							const ev = touch ? touch[0] : (e as MouseEvent);
							const freshBounds = this._mapB
								.getContainer()
								.getBoundingClientRect();
							let x = ev.clientX - freshBounds.left;
							if (x < 0) x = 0;
							if (x > freshBounds.width) x = freshBounds.width;
							return x;
						};
					}

					_before.fitBounds([sw, ne], { padding: 0, animate: false });
				};

				Promise.all([
					new Promise<void>((resolve) => _before.on("load", () => resolve())),
					new Promise<void>((resolve) => _after.on("load", () => resolve())),
				]).then(onMapsLoaded);
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
			selectedBuildingIdRef.current = null;
			layersReadyRef.current = false;
			compareRef.current?.remove();
			beforeMap?.remove();
			afterMap?.remove();
			beforeMapRef.current = null;
			afterMapRef.current = null;
		};
		// xbdId is intentionally excluded; scene switches are handled by Effect 2.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openPopup, updatePopupPos, retryCount]);

	useEffect(() => {
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (!before || !after || !layersReadyRef.current) return;

		let cancelled = false;
		const abortController = new AbortController();
		setSceneLoading(true);
		closePopup();

		fetchMapData(DISASTER_ID, xbdId, { signal: abortController.signal })
			.then(({ imagePair, buildings, bounds }) => {
				if (cancelled || !beforeMapRef.current || !afterMapRef.current) return;

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
	}, [xbdId, closePopup]);

	return (
		<div className="map-wrapper">
			<div ref={containerRef} className="map-container" />

			<MapControls
				disasterId={DISASTER_ID}
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
