import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";
import bbox from "@turf/bbox";

import buildings from "@/assets/hurricane-harvey_00000018_post_disaster.json";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

import {
	addBuildingLayer,
	BUILDINGS_FILL_LAYER_ID,
	BUILDINGS_SOURCE_ID,
	getBuildingDamageColor,
} from "@/utils/addBuildingLayer";
import { convertWKTToFeatureCollection } from "@/utils/convertWktToFeatureCollection";
import { BuildingPopup } from "./BuildingPopup";

// Set Mapbox access token from environment variable
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

function createBuildingPopupElement(
	uid: string | number,
	damage: string | undefined,
	damageColor: string,
	onClose: () => void,
): { element: HTMLElement; root: ReturnType<typeof createRoot> } {
	const container = document.createElement("div");
	const root = createRoot(container);

	root.render(
		<BuildingPopup
			uid={uid}
			damage={damage}
			damageColor={damageColor}
			onClose={onClose}
		/>,
	);

	return { element: container, root };
}

function attachBuildingHover(
	map: mapboxgl.Map,
	sourceId: string,
	fillLayerId: string,
): () => void {
	let hoveredId: number | null = null;

	const handleMouseMove = (e: mapboxgl.MapMouseEvent) => {
		const feature = e.features?.[0];
		if (!feature) return;

		map.getCanvas().style.cursor = "pointer";

		if (hoveredId !== null) {
			map.setFeatureState(
				{ source: sourceId, id: hoveredId },
				{ hover: false },
			);
		}

		hoveredId = feature.id as number;
		map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: true });
	};

	const handleMouseLeave = () => {
		map.getCanvas().style.cursor = "";

		if (hoveredId !== null) {
			map.setFeatureState(
				{ source: sourceId, id: hoveredId },
				{ hover: false },
			);
		}

		hoveredId = null;
	};

	map.on("mousemove", fillLayerId, handleMouseMove);
	map.on("mouseleave", fillLayerId, handleMouseLeave);

	// Return cleanup function
	return () => {
		map.off("mousemove", fillLayerId, handleMouseMove);
		map.off("mouseleave", fillLayerId, handleMouseLeave);
	};
}

function attachBuildingClick(
	map: mapboxgl.Map,
	fillLayerId: string,
	popupHolder: { current: mapboxgl.Popup | null },
): () => void {
	const handleClick = (e: mapboxgl.MapMouseEvent) => {
		const feature = e.features?.[0];
		if (!feature) return;

		const uid = feature.properties?.uid;
		const damage = feature.properties?.predicted_damage;
		const damageColor = getBuildingDamageColor(
			typeof damage === "string" ? damage : undefined,
		);

		popupHolder.current?.remove();
		popupHolder.current = null;

		const popup = new mapboxgl.Popup({ offset: 10, closeButton: false });
		const close = () => {
			popup.remove();
			popupHolder.current = null;
		};

		const { element: popupElement, root } = createBuildingPopupElement(
			uid,
			damage,
			damageColor,
			close,
		);
		popup.setDOMContent(popupElement);
		popup.setLngLat(e.lngLat).addTo(map);
		popupHolder.current = popup;

		// Clean up React root when popup is removed
		popup.on("close", () => {
			root.unmount();
		});
	};

	map.on("click", fillLayerId, handleClick);

	// Return cleanup function
	return () => {
		map.off("click", fillLayerId, handleClick);
	};
}

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		let buildingCleanups: (() => void)[] = [];

		// Clear container (important for React Strict Mode)
		containerRef.current.innerHTML = "";

		// Create two divs — one for each map (before/after)
		const beforeDiv = document.createElement("div");
		const afterDiv = document.createElement("div");

		// Make both maps fill the container
		Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
		Object.assign(afterDiv.style, { position: "absolute", inset: "0" });

		containerRef.current.appendChild(beforeDiv);
		containerRef.current.appendChild(afterDiv);

		// Convert WKT → GeoJSON (coordinates are already in lng/lat)
		const geojson = convertWKTToFeatureCollection(buildings.features.lng_lat);

		// Mock predicted_damage for testing (if API not ready)
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
					damageClasses[i % damageClasses.length]; // loop through classes
			}
		});

		// Derive image bounds from the actual polygon extents.
		// This ensures the raster overlay is anchored to the same
		// coordinate space as the building polygons.
		const [minLng, minLat, maxLng, maxLat] = bbox(geojson);

		const bounds: [
			[number, number],
			[number, number],
			[number, number],
			[number, number],
		] = [
			[minLng, maxLat], // top-left
			[maxLng, maxLat], // top-right
			[maxLng, minLat], // bottom-right
			[minLng, minLat], // bottom-left
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

			// Add zoom and compass controls to the top-right
			map.addControl(new mapboxgl.NavigationControl(), "top-right");

			return map;
		};

		// Initialize the "before" map
		const beforeMap = createMap(beforeDiv);

		// Initialize the "after" map
		const afterMap = createMap(afterDiv);

		/**
		 * This runs only after BOTH maps finish loading.
		 * We must wait for load before adding sources/layers.
		 */
		const onMapsLoaded = () => {
			// Add Pre-Disaster Image Layer
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

			// Add Post-Disaster Image Layer
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

			// Add building overlays to BOTH maps
			addBuildingLayer(beforeMap, geojson);
			addBuildingLayer(afterMap, geojson);

			const beforePopup: { current: mapboxgl.Popup | null } = { current: null };
			const afterPopup: { current: mapboxgl.Popup | null } = { current: null };

			buildingCleanups = [
				attachBuildingHover(
					beforeMap,
					BUILDINGS_SOURCE_ID,
					BUILDINGS_FILL_LAYER_ID,
				),
				attachBuildingHover(
					afterMap,
					BUILDINGS_SOURCE_ID,
					BUILDINGS_FILL_LAYER_ID,
				),
				attachBuildingClick(beforeMap, BUILDINGS_FILL_LAYER_ID, beforePopup),
				attachBuildingClick(afterMap, BUILDINGS_FILL_LAYER_ID, afterPopup),
			];

			// Enable Swipe Comparison
			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);

				// Override the default _getX method to ensure the swipe handle stays within bounds, even if the container is resized or has padding.
				// This fixes a long-term bug where the slider shifts/teleports when re-sizing the browser. -JH
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

			// Fit map to image bounds
			beforeMap.fitBounds([sw, ne], {
				padding: 0,
				animate: false,
			});
		};

		// Wait for both maps to fully load
		Promise.all([
			new Promise<void>((resolve) => beforeMap.on("load", () => resolve())),
			new Promise<void>((resolve) => afterMap.on("load", () => resolve())),
		]).then(onMapsLoaded);

		// Cleanup on component unmount
		return () => {
			for (const cleanup of buildingCleanups) {
				cleanup();
			}

			compareRef.current?.remove();
			beforeMap.remove();
			afterMap.remove();
		};
	}, []);

	return (
		<div
			ref={containerRef}
			style={{
				position: "relative",
				width: "100%",
				height: "600px",
				borderRadius: "16px",
				overflow: "hidden",
			}}
		/>
	);
}
