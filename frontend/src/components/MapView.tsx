import mapboxgl from "mapbox-gl";
import React, { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import postImage from "@/assets/hurricane-harvey_00000018_post_disaster.png";

import preImage from "@/assets/hurricane-harvey_00000018_pre_disaster.png";
import { Button } from "@/components/ui/button";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

if (!mapboxgl.accessToken) {
	console.error(
		"MapBox access token is missing. Please set VITE_MAPBOX_TOKEN in your .env file",
	);
}

type ImageCoordinates = [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
];

export default function MapView() {
	const mapRef = useRef<mapboxgl.Map | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const [activeLayer, setActiveLayer] = useState<"pre" | "post" | "satellite">(
		"satellite",
	);

	useEffect(() => {
		if (!containerRef.current || mapRef.current) return;

		const geoTransform = [
			-95.38617002293283, 4.5424316412367235e-6, 0, 29.757340952690797, 0,
			-4.5424316412367235e-6,
		];

		const map = new mapboxgl.Map({
			container: containerRef.current,
			style: "mapbox://styles/mapbox/satellite-v9",
			center: [-95.386, 29.757],
			zoom: 14,
		});
		map.addControl(
			new mapboxgl.NavigationControl({
				showCompass: true,
				showZoom: true,
			}),
			"top-right",
		);

		map.on("load", () => {
			const img = new Image();
			img.src = preImage;

			img.onload = () => {
				const coordinates = getImageCoordinates(
					geoTransform,
					img.width,
					img.height,
				);

				// PRE
				map.addSource("pre-image", {
					type: "image",
					url: preImage,
					coordinates,
				});

				map.addLayer({
					id: "pre-layer",
					type: "raster",
					source: "pre-image",
					layout: { visibility: "none" },
					paint: { "raster-opacity": 1 },
				});

				// POST
				map.addSource("post-image", {
					type: "image",
					url: postImage,
					coordinates,
				});

				map.addLayer({
					id: "post-layer",
					type: "raster",
					source: "post-image",
					layout: { visibility: "none" },
					paint: { "raster-opacity": 1 },
				});
			};
		});

		mapRef.current = map;

		return () => {
			map.remove();
			mapRef.current = null;
		};
	}, []);

	// Toggle layers
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !map.isStyleLoaded()) return;

		if (!map.getLayer("pre-layer") || !map.getLayer("post-layer")) return;

		map.setLayoutProperty("pre-layer", "visibility", "none");
		map.setLayoutProperty("post-layer", "visibility", "none");

		if (activeLayer === "pre") {
			map.setLayoutProperty("pre-layer", "visibility", "visible");
		}

		if (activeLayer === "post") {
			map.setLayoutProperty("post-layer", "visibility", "visible");
		}
	}, [activeLayer]);

	return (
		<div className="relative w-full">
			{/* Map */}
			<div
				ref={containerRef}
				className="w-full h-[600px] rounded-xl overflow-hidden border border-border shadow-md"
			/>

			{/* Controls */}
			<div className="absolute top-4 left-4 flex gap-2 p-3 rounded-xl bg-card border border-border shadow-lg backdrop-blur-md">
				<Button
					variant={activeLayer === "pre" ? "default" : "outline"}
					onClick={() => setActiveLayer("pre")}
					className={
						activeLayer !== "pre"
							? "hover:bg-accent hover:text-accent-foreground"
							: ""
					}
				>
					Show Pre
				</Button>

				<Button
					variant={activeLayer === "post" ? "default" : "outline"}
					onClick={() => setActiveLayer("post")}
					className={
						activeLayer !== "post"
							? "hover:bg-accent hover:text-accent-foreground"
							: ""
					}
				>
					Show Post
				</Button>

				<Button
					variant={activeLayer === "satellite" ? "default" : "outline"}
					onClick={() => setActiveLayer("satellite")}
					className={
						activeLayer !== "satellite"
							? "hover:bg-accent hover:text-accent-foreground"
							: ""
					}
				>
					Show Satellite
				</Button>
			</div>
		</div>
	);
}

function getImageCoordinates(
	geo: number[],
	width: number,
	height: number,
): ImageCoordinates {
	const originX = geo[0];
	const pixelWidth = geo[1];
	const originY = geo[3];
	const pixelHeight = geo[5];

	const west = originX;
	const east = originX + width * pixelWidth;
	const north = originY;
	const south = originY + height * pixelHeight;

	return [
		[west, north],
		[east, north],
		[east, south],
		[west, south],
	];
}
