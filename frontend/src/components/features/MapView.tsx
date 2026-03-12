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

function createPopupHTML(uid: string, damage: string, damageColor: string) {
	return `
	<div style="
		width:260px;
		background:hsl(var(--card));
		color:hsl(var(--card-foreground));
		border-radius:12px;
		overflow:hidden;
		font-family:'Space Grotesk', 'Segoe UI', sans-serif;
		box-shadow:0 10px 28px rgba(0,0,0,0.35);
	">

		<div style="
			background:linear-gradient(90deg,#6366f1,#8b5cf6);
			color:white;
			padding:10px 14px;
			font-size:14px;
			font-weight:600;
			display:flex;
			align-items:center;
			justify-content:space-between;
		">
			<span>🏠 Building Damage Report</span>

			<div
			  onclick="this.closest('.mapboxgl-popup').remove()"
			  style="
				width:28px;
				height:28px;
				display:flex;
				align-items:center;
				justify-content:center;
				line-height:1;
				font-size:18px;
				background:rgba(0,0,0,0.25);
				border-radius:8px;
				cursor:pointer;
				user-select:none;
				flex-shrink:0;
			  "
			>×</div>
		</div>

		<div style="
			padding:12px 14px;
			font-size:13px;
		">

			<div style="margin-bottom:14px;">
				<div style="
					font-size:11px;
					opacity:0.7;
					margin-bottom:2px;
				">
					Building ID
				</div>

				<div style="
					font-weight:600;
					word-break:break-all;
				">
					${uid}
				</div>
			</div>

			<div>
				<div style="
					font-size:11px;
					opacity:0.7;
					margin-bottom:4px;
				">
					Predicted Damage
				</div>

				<span style="
					display:inline-block;
					padding:4px 10px;
					border-radius:6px;
					background:${damageColor};
					color:white;
					font-weight:600;
					font-size:12px;
				">
					${damage}
				</span>
			</div>

		</div>

	</div>
	`;
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

			let hoveredBeforeId: number | null = null;

			beforeMap.on("mousemove", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;

				console.log(feature.id);

				beforeMap.getCanvas().style.cursor = "pointer";

				if (hoveredBeforeId !== null) {
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					);
				}

				hoveredBeforeId = feature.id as number;

				beforeMap.setFeatureState(
					{ source: "buildings-source", id: hoveredBeforeId },
					{ hover: true },
				);
			});

			beforeMap.on("mouseleave", "buildings-fill", () => {
				beforeMap.getCanvas().style.cursor = "";

				if (hoveredBeforeId !== null) {
					beforeMap.setFeatureState(
						{ source: "buildings-source", id: hoveredBeforeId },
						{ hover: false },
					);
				}

				hoveredBeforeId = null;
			});

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
				}

				hoveredAfterId = feature.id as number;

				afterMap.setFeatureState(
					{ source: "buildings-source", id: hoveredAfterId },
					{ hover: true },
				);
			});

			afterMap.on("mouseleave", "buildings-fill", () => {
				afterMap.getCanvas().style.cursor = "";

				if (hoveredAfterId !== null) {
					afterMap.setFeatureState(
						{ source: "buildings-source", id: hoveredAfterId },
						{ hover: false },
					);
				}

				hoveredAfterId = null;
			});

			//WHen the building is clicked on the before map showing some information about that building
			beforeMap.on("click", "buildings-fill", (e) => {
				//Mapbox returns a list of features and we take the first one
				const feature = e.features?.[0];

				//if for some reason no feature is found the stopping there
				if (!feature) return;

				//Getting the building id and predicted damage from properties
				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;

				const damageColor = getDamageColor(damage);

				//Creating a popup at the clickable area that displays the building info
				new mapboxgl.Popup({ offset: 20, closeButton: false })
					.setLngLat(e.lngLat)
					.setHTML(createPopupHTML(uid, damage, damageColor))

					.addTo(beforeMap);
			});

			afterMap.on("click", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;

				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;
				const damageColor = getDamageColor(damage);

				new mapboxgl.Popup({ offset: 20, closeButton: false })
					.setLngLat(e.lngLat)
					.setHTML(createPopupHTML(uid, damage, damageColor))
					.addTo(afterMap);
			});

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
