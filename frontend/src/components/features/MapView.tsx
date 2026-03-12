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

			//WHen the building is clicked on the before map shoing some information about that building
			beforeMap.on("click", "buildings-fill", (e) => {
				//Mpabox returns a list of features and we take the first one
				const feature = e.features?.[0];

				//if for osme reason no feature is found the stopping there
				if (!feature) return;

				//Getting the building id and predicted damage from properties
				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;

				let damageColor = "#ccc";
				if (damage === "no-damage") damageColor = "#2ecc71";
				else if (damage === "minor-damage") damageColor = "#f1c40f";
				else if (damage === "major-damage") damageColor = "#e67e22";
				else if (damage === "destroyed") damageColor = "#e74c3c";
				else damageColor = "#95a5a6";

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

				let damageColor = "#ccc";
				if (damage === "no-damage") damageColor = "#2ecc71";
				else if (damage === "minor-damage") damageColor = "#f1c40f";
				else if (damage === "major-damage") damageColor = "#e67e22";
				else if (damage === "destroyed") damageColor = "#e74c3c";
				else damageColor = "#95a5a6";

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
