import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";

import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * Hardcoded GeoTransform from xview_geotransforms.json
 * Format:
 * [originX, pixelWidth, 0, originY, 0, pixelHeight]
 */
const geoTransform = [
	-95.38617002293283, 4.5424316412367235e-6, 0, 29.757340952690797, 0,
	-4.5424316412367235e-6,
];

const IMAGE_SIZE = 1024;

/**
 * Compute geographic bounds from GeoTransform
 * Returns coordinates in Mapbox order:
 * [top-left, top-right, bottom-right, bottom-left]
 */
function computeBounds(): [number, number][] {
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

		const beforeDiv = document.createElement("div");
		const afterDiv = document.createElement("div");

		Object.assign(beforeDiv.style, {
			position: "absolute",
			inset: "0",
		});

		Object.assign(afterDiv.style, {
			position: "absolute",
			inset: "0",
		});

		containerRef.current.appendChild(beforeDiv);
		containerRef.current.appendChild(afterDiv);

		const bounds = computeBounds();
		const sw = bounds[3]; // bottom-left
		const ne = bounds[1]; // top-right

		const beforeMap = new mapboxgl.Map({
			container: beforeDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});

		const afterMap = new mapboxgl.Map({
			container: afterDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});

		const onMapsLoaded = () => {
			// Pre-disaster image
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

			// Post-disaster image
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

			// Enable swipe comparison
			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);
			}

			// Fit camera to image bounds
			beforeMap.fitBounds([sw, ne], {
				padding: 0,
				animate: false,
			});
		};

		Promise.all([
			new Promise<void>((resolve) => beforeMap.on("load", () => resolve())),
			new Promise<void>((resolve) => afterMap.on("load", () => resolve())),
		]).then(onMapsLoaded);

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
