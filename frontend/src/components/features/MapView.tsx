import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";
import bbox from "@turf/bbox";

import buildings from "@/assets/hurricane-harvey_00000018_post_disaster.json";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

import { addBuildingLayer } from "@/utils/addBuildingLayer";
import { convertWKTToFeatureCollection } from "@/utils/convertWktToFeatureCollection";
import { BuildingPopup } from "@/components/features/BuildingPopup";

interface PopupData {
	uid: string;
	damage: string;
	damageColor: string;
	lngLat: mapboxgl.LngLat;
}

function getDamageColor(damage?: string): string {
	switch (damage) {
		case "no-damage":
			return "#2ecc71";
		case "minor-damage":
			return "#f1c40f";
		case "major-damage":
			return "#e67e22";
		case "destroyed":
			return "#e74c3c";
		case "un-classified":
			return "#95a5a6";
		default:
			return "#ccc";
	}
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/** Apply visibility to both building layers on a single map instance. */
const setBuildingVisibility = (map: mapboxgl.Map, visible: boolean) => {
	const visibility = visible ? "visible" : "none";
	map.setLayoutProperty("buildings-fill", "visibility", visibility);
	map.setLayoutProperty("buildings-outline", "visibility", visibility);
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

	/** Reproject the stored lngLat to current pixel coords via afterMap. */
	const updatePopupPos = useCallback(() => {
		if (popupDataRef.current && afterMapRef.current) {
			const { x, y } = afterMapRef.current.project(popupDataRef.current.lngLat);
			setPopupPos({ x, y });
		}
	}, []);

	const closePopup = useCallback(() => {
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

			// --- Hover: before map ---
			let hoveredBeforeId: number | null = null;

			beforeMap.on("mousemove", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;
				beforeMap.getCanvas().style.cursor = "pointer";
				if (hoveredBeforeId !== null) {
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					);
					afterMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					); // sync both maps
				}
				hoveredBeforeId = feature.id as number;
				beforeMap.setFeatureState(
					{ source: "buildings-source", id: hoveredBeforeId },
					{ hover: true },
				);
				afterMap.setFeatureState(
					{ source: "buildings-source", id: hoveredBeforeId },
					{ hover: true },
				); // sync both maps
			});

			beforeMap.on("mouseleave", "buildings-fill", () => {
				beforeMap.getCanvas().style.cursor = "";
				if (hoveredBeforeId !== null) {
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					);
					afterMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					); // sync both maps
				}
				hoveredBeforeId = null;
			});

			// --- Hover: after map ---
			let hoveredAfterId: number | null = null;

			afterMap.on("mousemove", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;
				afterMap.getCanvas().style.cursor = "pointer";
				if (hoveredAfterId !== null) {
					afterMap.setFeatureState(
						{ source: "buildings-source", id: hoveredAfterId },
						{ hover: false },
					);
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredAfterId },
						{ hover: false },
					); // sync both maps
				}
				hoveredAfterId = feature.id as number;
				afterMap.setFeatureState(
					{ source: "buildings-source", id: hoveredAfterId },
					{ hover: true },
				);
				beforeMap.setFeatureState(
					{ source: "buildings-source", id: hoveredAfterId },
					{ hover: true },
				); // sync both maps
			});

			afterMap.on("mouseleave", "buildings-fill", () => {
				afterMap.getCanvas().style.cursor = "";
				if (hoveredAfterId !== null) {
					afterMap.setFeatureState(
						{ source: "buildings-source", id: hoveredAfterId },
						{ hover: false },
					);
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredAfterId },
						{ hover: false },
					); // sync both maps
				}
				hoveredAfterId = null;
			});

			// --- Click handlers ---
			// Both maps use the same handler. The popup is rendered by React in an
			// overlay div above both map containers, so it's never clipped by the
			// compare slider. afterMap.project() is used for pixel positioning since
			// both maps are synced to the same viewport.
			const handleBuildingClick = (
				e: mapboxgl.MapMouseEvent & {
					features?: mapboxgl.MapboxGeoJSONFeature[];
				},
			) => {
				const feature = e.features?.[0];
				if (!feature) return;

				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;
				const damageColor = getDamageColor(damage);

				openPopup({ uid, damage, damageColor, lngLat: e.lngLat });
			};

			beforeMap.on("click", "buildings-fill", handleBuildingClick);
			afterMap.on("click", "buildings-fill", handleBuildingClick);

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