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

		// Initialize the "before" map
		const beforeMap = new mapboxgl.Map({
			container: beforeDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});
		// Add zoom and compass controls to the top-right
		beforeMap.addControl(new mapboxgl.NavigationControl(), "top-right");

		// Initialize the "after" map
		const afterMap = new mapboxgl.Map({
			container: afterDiv,
			style: "mapbox://styles/mapbox/satellite-v9",
			renderWorldCopies: false,
		});
		// Add zoom and compass controls to the top-right
		afterMap.addControl(new mapboxgl.NavigationControl(), "top-right");

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

			//When the mouse is placed on a building polygon the cursor is chnaged to "pointer"
			//Make the user feel that the building is clickable
			beforeMap.on("mouseenter", "buildings-fill", (e) => {
				beforeMap.getCanvas().style.cursor = "pointer";

				const feature = e.features?.[0];
				if (!feature) return;

				beforeMap.setPaintProperty(
					"buildings-outline",
					"line-color",
					"#0df3f3cb",
				);
				beforeMap.setPaintProperty("buildings-outline", "line-width", 3);
			});

			//Restores the cursor when the mouse is moved away from the building polygon
			beforeMap.on("mouseleave", "buildings-fill", () => {
				beforeMap.getCanvas().style.cursor = "";
				beforeMap.setPaintProperty("buildings-outline", "line-color", "white");
				beforeMap.setPaintProperty("buildings-outline", "line-width", 1);
			});

			//Applying the same hover interaction to the after map as well
			afterMap.on("mouseenter", "buildings-fill", (e) => {
				afterMap.getCanvas().style.cursor = "pointer";

				const feature = e.features?.[0];
				if (!feature) return;

				afterMap.setPaintProperty(
					"buildings-outline",
					"line-color",
					"#0df3f3cb",
				);
				afterMap.setPaintProperty("buildings-outline", "line-width", 3);
			});

			afterMap.on("mouseleave", "buildings-fill", () => {
				afterMap.getCanvas().style.cursor = "";

				afterMap.setPaintProperty("buildings-outline", "line-color", "white");
				afterMap.setPaintProperty("buildings-outline", "line-width", 1);
			});

			//WHen the building is clicked on the before map shoing some information about that building
			beforeMap.on("click", "buildings-fill", (e) => {
				//Mpabox returns a list of features and we take the first one
				const feature = e.features?.[0];

				//if for osme reason no feature is found the stopping there
				if (!feature) return;

				//Getting the building id and predicted damage from properties
				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;

				let damageColor = getDamageColor(damage);

				//Creating a popup at the clickable area that displays the building info
				new mapboxgl.Popup({ offset: 20 })
					.setLngLat(e.lngLat)
					.setHTML(`
    				<div style="
      				width:260px;
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
						<div>${uid}</div>
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
						${damage}
						</span>

						</div>

						</div>

						</div>
  						`)
					.addTo(beforeMap);
			});

			//Same interaction after clicking for teh after map
			afterMap.on("click", "buildings-fill", (e) => {
				//Mpabox returns a list of features and we take the first one
				const feature = e.features?.[0];

				//if for osme reason no feature is found the stopping there
				if (!feature) return;

				//Getting the building id and predicted damage from properties
				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;

				let damageColor = getDamageColor(damage);

				new mapboxgl.Popup({ offset: 20 })
					.setLngLat(e.lngLat)
					.setHTML(`
					<div style="
					 	width:260px;
						background:white;
						border-radius:12px;
						overflow:hidden;
						font-family:Arial, sans-serif;
						box-shadow:0 8px 22px rgba(0, 0, 0, 0.35);
					">
					
					<div style="
						background:linear-gradient(90deg, #5f6dff, #9c6bff);
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
						margin-bottom:8px;
						color:#444;
					">

					<div style="margin-bottom:14px;">
  						<div style="font-weight:bold; margin-bottom:4px;">Building ID:</div>
  						<div>${uid}</div>
					</div>

					<div>
					<span style="
						font-weight:bold;">Predicted Damage:</span><br/>
						<span style="
  							display:inline-block;
  							margin-top:4px;
  							 padding:4px 10px;
  							border-radius:6px;
  							background:${damageColor};
							color:white;
  							font-weight:bold;
						">
						${damage}
					</span>
					</div>

					</div>

				</div>
						
				`)

					.addTo(afterMap);
			});

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
				height: "600px",
				borderRadius: "16px",
				overflow: "hidden",
			}}
		/>
	);
}
