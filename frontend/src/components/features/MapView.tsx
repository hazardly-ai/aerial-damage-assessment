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

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const geoTransform = [
	-95.38617002293283, 4.5424316412367235e-6, 0, 29.757340952690797, 0,
	-4.5424316412367235e-6,
];

const IMAGE_SIZE = 1024;

function computeBounds(): [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
] {
	const [originX, pixelWidth, , originY, , pixelHeight] = geoTransform;

	return [
		[originX, originY],
		[originX + pixelWidth * IMAGE_SIZE, originY],
		[originX + pixelWidth * IMAGE_SIZE, originY + pixelHeight * IMAGE_SIZE],
		[originX, originY + pixelHeight * IMAGE_SIZE],
	];
}

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		containerRef.current.innerHTML = "";

		const beforeDiv = document.createElement("div");
		const afterDiv = document.createElement("div");

		Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
		Object.assign(afterDiv.style, { position: "absolute", inset: "0" });

		containerRef.current.appendChild(beforeDiv);
		containerRef.current.appendChild(afterDiv);

		const bounds = computeBounds();
		const sw = bounds[3];
		const ne = bounds[1];

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

			// ✅ FIXED: Extract lng_lat correctly
			const geojson = convertWKTToFeatureCollection(buildings.features.lng_lat);

			addBuildingLayer(beforeMap, geojson);
			addBuildingLayer(afterMap, geojson);

			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);
			}

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
