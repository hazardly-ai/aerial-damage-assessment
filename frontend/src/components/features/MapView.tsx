import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";
import bbox from "@turf/bbox";

import buildings from "@/assets/hurricane-harvey_00000018_post_disaster.json";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

import { addBuildingLayer } from "@/utils/addBuildingLayer";
import { convertWKTToFeatureCollection } from "@/utils/convertWktToFeatureCollection";

// Set Mapbox access token from environment variable
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MAP_HEIGHT = "600px";
const POPUP_OFFSET = 20;
const POPUP_WIDTH = 260;

interface BuildingProperties {
	uid?: string | number;
	predicted_damage?: string;
}

interface MapFeature extends mapboxgl.GeoJSONFeature {
	properties: BuildingProperties | null;
}

function createPopupContent(uid?: string | number, damage?: string): string {
	const damageColor = getDamageColor(damage);
	return `
		<div style="
			width:${POPUP_WIDTH}px;
			background:white;
			border-radius:12px;
			overflow:hidden;
			font-family:Arial, sans-serif;
			box-shadow:0 8px 22px rgba(0,0,0,0.35);
		">
			<div style="
				background:linear-gradient(90deg,#5f6dff,#9c6bff);
				color:white;
				padding:10px 36px 10px 14px;
				font-size:15px;
				font-weight:bold;
			">
				🏠 Building Damage Report
			</div>
			<div style="
				padding:12px 14px;
				font-size:13px;
				font-weight:bold;
				color:#444;
			">
				<div style="margin-bottom:14px;">
					<div style="font-weight:bold; margin-bottom:4px;">Building ID:</div>
					<div>${uid ?? "N/A"}</div>
				</div>
				<div>
					<span style="font-weight:bold;">Predicted Damage:</span><br/>
					<span style="
						display:inline-block;
						margin-top:4px;
						padding:4px 10px;
						border-radius:6px;
						background:${damageColor};
						color:white;
						font-weight:bold;
					">
						${damage ?? "Unknown"}
					</span>
				</div>
			</div>
		</div>
	`;
}

function setupMapInteractions(map: mapboxgl.Map) {
	// Mouse hover interactions
	map.on("mouseenter", "buildings-fill", () => {
		map.getCanvas().style.cursor = "pointer";
		map.setPaintProperty("buildings-outline", "line-color", "#0df3f3cb");
		map.setPaintProperty("buildings-outline", "line-width", 3);
	});

	map.on("mouseleave", "buildings-fill", () => {
		map.getCanvas().style.cursor = "";
		map.setPaintProperty("buildings-outline", "line-color", "white");
		map.setPaintProperty("buildings-outline", "line-width", 1);
	});

	// Click interaction
	map.on(
		"click",
		"buildings-fill",
		(e: mapboxgl.MapMouseEvent & { features?: MapFeature[] }) => {
			const feature = e.features?.[0];
			if (!feature) return;

			const { uid, predicted_damage } = feature.properties || {};

			new mapboxgl.Popup({ offset: POPUP_OFFSET })
				.setLngLat(e.lngLat)
				.setHTML(createPopupContent(uid, predicted_damage))
				.addTo(map);
		},
	);
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

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

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

			// Setup interactions for both maps
			setupMapInteractions(beforeMap);
			setupMapInteractions(afterMap);

			// Enable Swipe Comparison
			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);
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
				height: MAP_HEIGHT,
				borderRadius: "16px",
				overflow: "hidden",
			}}
		/>
	);
}
