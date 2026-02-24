import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";

import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";
import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const coordinates: [number, number][] = [
	[-95.38617002293283, 29.757340952690797],
	[-95.38151857293221, 29.757340952690797],
	[-95.38151857293221, 29.75268950269017],
	[-95.38617002293283, 29.75268950269017],
];

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		containerRef.current.innerHTML = "";

		const beforeDiv = document.createElement("div");
		const afterDiv = document.createElement("div");

		beforeDiv.style.position = "absolute";
		beforeDiv.style.top = "0";
		beforeDiv.style.bottom = "0";
		beforeDiv.style.width = "100%";

		afterDiv.style.position = "absolute";
		afterDiv.style.top = "0";
		afterDiv.style.bottom = "0";
		afterDiv.style.width = "100%";

		containerRef.current.appendChild(beforeDiv);
		containerRef.current.appendChild(afterDiv);

		const beforeMap = new mapboxgl.Map({
			container: beforeDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			center: [-95.3838, 29.755],
			zoom: 17,
		});

		const afterMap = new mapboxgl.Map({
			container: afterDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			center: [-95.3838, 29.755],
			zoom: 17,
		});

		// 🔹 Add zoom + compass controls to both maps
		beforeMap.addControl(
			new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }),
			"top-right",
		);
		afterMap.addControl(
			new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }),
			"top-right",
		);

		let mapsLoaded = 0;
		const checkLoaded = () => {
			mapsLoaded++;
			if (mapsLoaded === 2 && containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);
			}
		};

		beforeMap.on("load", () => {
			beforeMap.addSource("pre-image", {
				type: "image",
				url: preImage,
				coordinates: coordinates,
			});

			beforeMap.addLayer({
				id: "pre-layer",
				type: "raster",
				source: "pre-image",
			});

			checkLoaded();
		});

		afterMap.on("load", () => {
			afterMap.addSource("post-image", {
				type: "image",
				url: postImage,
				coordinates: coordinates,
			});

			afterMap.addLayer({
				id: "post-layer",
				type: "raster",
				source: "post-image",
			});

			checkLoaded();
		});

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
