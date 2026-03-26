import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";
import bbox from "@turf/bbox";
import type { Feature } from "geojson";

import buildings from "@/assets/hurricane-harvey_00000018_post_disaster.json";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";
import { BuildingPopup } from "@/components/features/BuildingPopup";
import {
	addBuildingLayer,
	BUILDINGS_FILL_LAYER_ID,
	BUILDINGS_OUTLINE_LAYER_ID,
	BUILDINGS_SOURCE_ID,
	getBuildingDamageColor,
} from "@/utils/addBuildingLayer";
import { convertWKTToFeatureCollection } from "@/utils/convertWktToFeatureCollection";

interface PopupData {
	uid: string;
	damage?: string;
	damageColor: string;
	lngLat: mapboxgl.LngLat;
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/** Apply visibility to both building layers on a single map instance. */
const setBuildingVisibility = (map: mapboxgl.Map, visible: boolean) => {
	const visibility = visible ? "visible" : "none";
	map.setLayoutProperty(BUILDINGS_FILL_LAYER_ID, "visibility", visibility);
	map.setLayoutProperty(BUILDINGS_OUTLINE_LAYER_ID, "visibility", visibility);
};

const asString = (value: unknown): string | undefined => {
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);
	const beforeMapRef = useRef<mapboxgl.Map | null>(null);
	const afterMapRef = useRef<mapboxgl.Map | null>(null);
	const layersReadyRef = useRef(false);

	const [buildingsVisible, setBuildingsVisible] = useState(true);

	// Popup rendered in React above both map containers — never clipped by the
	// compare slider regardless of which side the user clicked.
	const [popupData, setPopupData] = useState<PopupData | null>(null);
	const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(
		null,
	);

	// Ref so the map `move` handler always reads the latest lngLat without
	// stale-closure issues.
	const popupDataRef = useRef<PopupData | null>(null);
	const selectedBuildingIdRef = useRef<string | number | null>(null);

	/** Reproject the stored lngLat to current pixel coords via afterMap. */
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

	useEffect(() => {
		if (!containerRef.current) return;

		containerRef.current.innerHTML = "";

		const beforeDiv = document.createElement("div");
		const afterDiv = document.createElement("div");

		Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
		Object.assign(afterDiv.style, { position: "absolute", inset: "0" });

		containerRef.current.appendChild(beforeDiv);
		containerRef.current.appendChild(afterDiv);

		const geojson = convertWKTToFeatureCollection(buildings.features.lng_lat);

		geojson.features.forEach((feature, i) => {
			const damageClasses = [
				"no-damage",
				"minor-damage",
				"major-damage",
				"destroyed",
				"un-classified",
			];
			if (feature.properties) {
				feature.properties.predicted_damage =
					damageClasses[i % damageClasses.length];
			}
		});

		const [minLng, minLat, maxLng, maxLat] = bbox(geojson);

		const bounds: [
			[number, number],
			[number, number],
			[number, number],
			[number, number],
		] = [
			[minLng, maxLat],
			[maxLng, maxLat],
			[maxLng, minLat],
			[minLng, minLat],
		];

		const sw: [number, number] = [minLng, minLat];
		const ne: [number, number] = [maxLng, maxLat];

		const createMap = (container: HTMLElement) => {
			const map = new mapboxgl.Map({
				container,
				style: "mapbox://styles/mapbox/satellite-v9",
				renderWorldCopies: false,
			});

			map.on("style.load", () => {
				map.setPaintProperty("satellite", "raster-opacity", 0.4);
			});

			map.on("error", (e) => {
				console.error("Mapbox error:", e);
			});

			map.addControl(new mapboxgl.NavigationControl(), "top-right");

			return map;
		};

		const beforeMap = createMap(beforeDiv);
		beforeMapRef.current = beforeMap;

		const afterMap = createMap(afterDiv);
		afterMapRef.current = afterMap;

		const onMapsLoaded = () => {
			beforeMap.addSource("pre-image", {
				type: "image",
				url: preImage,
				coordinates: bounds,
			});
			beforeMap.addLayer({
				id: "pre-layer",
				type: "raster",
				source: "pre-image",
			});

			afterMap.addSource("post-image", {
				type: "image",
				url: postImage,
				coordinates: bounds,
			});
			afterMap.addLayer({
				id: "post-layer",
				type: "raster",
				source: "post-image",
			});

			addBuildingLayer(beforeMap, geojson);
			addBuildingLayer(afterMap, geojson);

			layersReadyRef.current = true;
			setBuildingsVisible((current) => {
				setBuildingVisibility(beforeMap, current);
				setBuildingVisibility(afterMap, current);
				return current;
			});

			// Keep popup anchored to its building as the user pans/zooms.
			afterMap.on("move", updatePopupPos);

			// Sync hover state across both maps to ensure visual consistency
			// when user hovers over building polygons on either map instance
			let hoveredId: string | number | null = null;

			const setHoverStateOnBothMaps = (id: string | number, hover: boolean) => {
				beforeMap.setFeatureState(
					{ source: BUILDINGS_SOURCE_ID, id },
					{ hover },
				);
				afterMap.setFeatureState(
					{ source: BUILDINGS_SOURCE_ID, id },
					{ hover },
				);
			};

			const clearHover = () => {
				if (hoveredId === null) return;
				setHoverStateOnBothMaps(hoveredId, false);
				hoveredId = null;
			};

			const bindSyncedHoverHandlers = (activeMap: mapboxgl.Map) => {
				activeMap.on("mousemove", BUILDINGS_FILL_LAYER_ID, (e) => {
					const feature = e.features?.[0];
					if (
						!feature ||
						(typeof feature.id !== "string" && typeof feature.id !== "number")
					) {
						return;
					}
					activeMap.getCanvas().style.cursor = "pointer";

					const nextHoveredId = feature.id;
					if (hoveredId === nextHoveredId) return;

					if (hoveredId !== null) {
						setHoverStateOnBothMaps(hoveredId, false);
					}

					hoveredId = nextHoveredId;
					setHoverStateOnBothMaps(nextHoveredId, true);
				});

				activeMap.on("mouseleave", BUILDINGS_FILL_LAYER_ID, () => {
					activeMap.getCanvas().style.cursor = "";
					clearHover();
				});
			};

			bindSyncedHoverHandlers(beforeMap);
			bindSyncedHoverHandlers(afterMap);

			// --- Click handlers ---
			// Both maps use the same handler. The popup is rendered by React in an
			// overlay div above both map containers, so it's never clipped by the
			// compare slider. afterMap.project() is used for pixel positioning since
			// both maps are synced to the same viewport.
			const handleBuildingClick = (
				e: mapboxgl.MapMouseEvent & {
					features?: Feature[];
				},
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
				const prevSelected = selectedBuildingIdRef.current;
				if (prevSelected !== null && prevSelected !== featureId) {
					beforeMap.setFeatureState(
						{ source: BUILDINGS_SOURCE_ID, id: prevSelected },
						{ selected: false },
					);
					afterMap.setFeatureState(
						{ source: BUILDINGS_SOURCE_ID, id: prevSelected },
						{ selected: false },
					);
				}
				selectedBuildingIdRef.current = featureId;
				beforeMap.setFeatureState(
					{ source: BUILDINGS_SOURCE_ID, id: featureId },
					{ selected: true },
				);
				afterMap.setFeatureState(
					{ source: BUILDINGS_SOURCE_ID, id: featureId },
					{ selected: true },
				);

				const damage = asString(feature.properties?.predicted_damage);
				const damageColor = getBuildingDamageColor(damage);

				openPopup({ uid, damage, damageColor, lngLat: e.lngLat });
			};

			beforeMap.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);
			afterMap.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);

			// Enable Swipe Comparison
			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
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
					const freshBounds = this._mapB.getContainer().getBoundingClientRect();
					let x = ev.clientX - freshBounds.left;
					if (x < 0) x = 0;
					if (x > freshBounds.width) x = freshBounds.width;
					return x;
				};
			}

			beforeMap.fitBounds([sw, ne], { padding: 0, animate: false });
		};

		Promise.all([
			new Promise<void>((resolve) => beforeMap.on("load", () => resolve())),
			new Promise<void>((resolve) => afterMap.on("load", () => resolve())),
		]).then(onMapsLoaded);

		return () => {
			selectedBuildingIdRef.current = null;
			afterMap.off("move", updatePopupPos);
			layersReadyRef.current = false;
			beforeMapRef.current = null;
			afterMapRef.current = null;
			compareRef.current?.remove();
			beforeMap.remove();
			afterMap.remove();
		};
	}, [openPopup, updatePopupPos]);

	return (
		<div className="map-wrapper">
			<div ref={containerRef} className="map-container" />

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

			<button
				type="button"
				className="building-toggle"
				data-active={buildingsVisible ? "true" : "false"}
				onClick={handleToggle}
				title={
					buildingsVisible ? "Hide building polygons" : "Show building polygons"
				}
			>
				<span className="building-toggle-track">
					<span className="building-toggle-knob" />
				</span>
				Show Building Polygons
			</button>
		</div>
	);
}
