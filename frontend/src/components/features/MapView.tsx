import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useRef, useState } from "react";
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
    <div class="popup-card">

      <div class="popup-header">
        <span>🏠 Building Damage Report</span>
        <div onclick="this.closest('.mapboxgl-popup').remove()" class="popup-close-btn">×</div>
      </div>

      <div class="popup-body">
        <div class="popup-section">
          <div class="popup-label">Building ID</div>
          <div class="popup-value">${uid}</div>
        </div>

        <div class="popup-section">
          <div class="popup-label">Predicted Damage</div>
          <span class="popup-damage" style="background:${damageColor}">${damage}</span>
        </div>
      </div>

    </div>
  `;
}

/** Apply visibility to both building layers on a single map instance. */
const setBuildingVisibility = (map: mapboxgl.Map, visible: boolean) => {
	const visibility = visible ? "visible" : "none";
	map.setLayoutProperty("buildings-fill", "visibility", visibility);
	map.setLayoutProperty("buildings-outline", "visibility", visibility);
};

export default function MapView() {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);

	// Keep stable refs to both map instances so the toggle can reach them
	// after the useEffect has finished setting up.
	const beforeMapRef = useRef<mapboxgl.Map | null>(null);
	const afterMapRef = useRef<mapboxgl.Map | null>(null);

	// Track whether layers have been added yet (both maps must be loaded first).
	const layersReadyRef = useRef(false);

	// Track all open popups so the toggle can dismiss them.
	const activePopupsRef = useRef<mapboxgl.Popup[]>([]);

	const [buildingsVisible, setBuildingsVisible] = useState(true);

	// Toggle handler — safe to call before layers are ready (no-op guard).
	const handleToggle = useCallback(() => {
		// Dismiss any open popups before toggling visibility.
		activePopupsRef.current.forEach((p) => {
			p.remove();
		});
		activePopupsRef.current = [];

		setBuildingsVisible((prev) => {
			const next = !prev;
			if (
				layersReadyRef.current &&
				beforeMapRef.current &&
				afterMapRef.current
			) {
				setBuildingVisibility(beforeMapRef.current, next);
				setBuildingVisibility(afterMapRef.current, next);
			}
			return next;
		});
	}, []);

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
					damageClasses[i % damageClasses.length];
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
		beforeMapRef.current = beforeMap;

		// Initialize the "after" map
		const afterMap = createMap(afterDiv);
		afterMapRef.current = afterMap;

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

			// Mark layers as ready and sync with any toggle state that changed
			// before load finished (e.g. user clicked very quickly).
			layersReadyRef.current = true;
			setBuildingsVisible((current) => {
				setBuildingVisibility(beforeMap, current);
				setBuildingVisibility(afterMap, current);
				return current;
			});

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

			// When the building is clicked on the before map, show information about that building
			beforeMap.on("click", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;

				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;
				const damageColor = getDamageColor(damage);

				const beforePopup = new mapboxgl.Popup({
					offset: 20,
					closeButton: false,
				})
					.setLngLat(e.lngLat)
					.setHTML(createPopupHTML(uid, damage, damageColor))
					.addTo(beforeMap);

				activePopupsRef.current.push(beforePopup);
				beforePopup.on("close", () => {
					activePopupsRef.current = activePopupsRef.current.filter(
						(p) => p !== beforePopup,
					);
				});
			});

			afterMap.on("click", "buildings-fill", (e) => {
				const feature = e.features?.[0];
				if (!feature) return;

				const uid = feature.properties?.uid;
				const damage = feature.properties?.predicted_damage;
				const damageColor = getDamageColor(damage);

				const afterPopup = new mapboxgl.Popup({
					offset: 20,
					closeButton: false,
				})
					.setLngLat(e.lngLat)
					.setHTML(createPopupHTML(uid, damage, damageColor))
					.addTo(afterMap);

				activePopupsRef.current.push(afterPopup);
				afterPopup.on("close", () => {
					activePopupsRef.current = activePopupsRef.current.filter(
						(p) => p !== afterPopup,
					);
				});
			});

			// Enable Swipe Comparison
			if (containerRef.current) {
				compareRef.current = new Compare(
					beforeMap,
					afterMap,
					containerRef.current,
				);

				// Override the default _getX method to ensure the swipe handle stays
				// within bounds, even if the container is resized or has padding.
				// This fixes a long-term bug where the slider shifts/teleports when
				// re-sizing the browser. -JH
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
			layersReadyRef.current = false;
			beforeMapRef.current = null;
			afterMapRef.current = null;
			compareRef.current?.remove();
			beforeMap.remove();
			afterMap.remove();
		};
	}, []);

	return (
		<div className="map-wrapper">
			{/* Map container */}
			<div ref={containerRef} className="map-container" />

			{/* Building polygon toggle */}
			<button
				type="button"
				className="building-toggle"
				data-active={buildingsVisible ? "true" : "false"}
				onClick={handleToggle}
				title={
					buildingsVisible ? "Hide building polygons" : "Show building polygons"
				}
			>
				<span className="building-toggle-track">
					<span className="building-toggle-knob" />
				</span>
				Show Building Polygons
			</button>
		</div>
	);
}
