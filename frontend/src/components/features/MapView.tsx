import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";

import buildings from "@/assets/hurricane-harvey_00000018_post_disaster.json";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

import { addBuildingLayer } from "@/utils/addBuildingLayer";
import { convertWKTToFeatureCollection } from "@/utils/convertWktToFeatureCollection";

// Set Mapbox access token from environment variable
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * GeoTransform defines how the image maps to geographic coordinates.
 * Format:
 * [originX, pixelWidth, 0, originY, 0, pixelHeight]
 *
 * This allows us to correctly georeference the raster images.
 */
const geoTransform = [
	-95.38617002293283, 4.5424316412367235e-6, 0, 29.757340952690797, 0,
	-4.5424316412367235e-6,
];

const IMAGE_SIZE = 1024;

/**
 * Compute geographic bounds for the image overlay.
 * Returns coordinates in Mapbox-required order:
 * [top-left, top-right, bottom-right, bottom-left]
 */
function computeBounds(): [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
] {
	const [originX, pixelWidth, , originY, , pixelHeight] = geoTransform;

	return [
		[originX, originY], // top-left
		[originX + pixelWidth * IMAGE_SIZE, originY], // top-right
		[originX + pixelWidth * IMAGE_SIZE, originY + pixelHeight * IMAGE_SIZE], // bottom-right
		[originX, originY + pixelHeight * IMAGE_SIZE], // bottom-left
	];
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

		// Compute image geographic bounds
		const bounds = computeBounds();

		// Extract southwest and northeast corners for fitBounds
		const sw = bounds[3];
		const ne = bounds[1];

		// Initialize the "before" map
		const beforeMap = new mapboxgl.Map({
			container: beforeDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});

		// Initialize the "after" map
		const afterMap = new mapboxgl.Map({
			container: afterDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});

		/**
		 * This runs only after BOTH maps finish loading.
		 * We must wait for load before adding sources/layers.
		 */
		const onMapsLoaded = () => {
			// ----------------------------
			// Add Pre-Disaster Image Layer
			// ----------------------------
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

			// ----------------------------
			// Add Post-Disaster Image Layer
			// ----------------------------
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

			// ---------------------------------------
			// Convert Local WKT → GeoJSON (Temporary)
			// ---------------------------------------
			// This isolates WKT parsing from Mapbox logic.
			// The map layer system only consumes GeoJSON.
			const geojson = convertWKTToFeatureCollection(buildings.features.lng_lat);

			// Add building overlays to BOTH maps
			addBuildingLayer(beforeMap, geojson);
			addBuildingLayer(afterMap, geojson);

			// ---------------------------------------
			// Enable Swipe Comparison
			// ---------------------------------------
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
				height: "600px",
				borderRadius: "16px",
				overflow: "hidden",
			}}
		/>
	);
}
