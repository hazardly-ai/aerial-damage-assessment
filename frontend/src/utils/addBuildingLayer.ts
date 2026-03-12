import type { Map as MapboxMap } from "mapbox-gl";

const SOURCE_ID = "buildings-source";
const FILL_LAYER_ID = "buildings-fill";
const OUTLINE_LAYER_ID = "buildings-outline";

// Map predicted_damage values to colors
const DAMAGE_COLOR_MAP: Record<string, string> = {
	"no-damage": "green",
	"minor-damage": "yellow",
	"major-damage": "orange",
	destroyed: "red",
	"un-classified": "gray",
};

export function addBuildingLayer(
	map: MapboxMap,
	geojson: GeoJSON.FeatureCollection,
) {
	if (!map.getStyle()) return;

	// Add or update source
	if (!map.getSource(SOURCE_ID)) {
		map.addSource(SOURCE_ID, {
			type: "geojson",
			data: geojson,
			generateId: true,
		});
	} else {
		const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
		source.setData(geojson);
	}

	// Add or update fill layer
	if (!map.getLayer(FILL_LAYER_ID)) {
		map.addLayer({
			id: FILL_LAYER_ID,
			type: "fill",
			source: SOURCE_ID,
			paint: {
				// Data-driven fill-color using predicted_damage
				"fill-color": [
					"match",
					["get", "predicted_damage"],
					"no-damage",
					DAMAGE_COLOR_MAP["no-damage"],
					"minor-damage",
					DAMAGE_COLOR_MAP["minor-damage"],
					"major-damage",
					DAMAGE_COLOR_MAP["major-damage"],
					"destroyed",
					DAMAGE_COLOR_MAP.destroyed,
					DAMAGE_COLOR_MAP["un-classified"], // default
				],
				"fill-opacity": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					0.7,
					0.4
				],
			},
		});
	}

	// Add or update outline layer
	if (!map.getLayer(OUTLINE_LAYER_ID)) {
		map.addLayer({
			id: OUTLINE_LAYER_ID,
			type: "line",
			source: SOURCE_ID,
			paint: {
				"line-color": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					"#202ead",
					"#ffffff"
				],
				"line-width": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					4,
					1
	],
			},
		}, FILL_LAYER_ID
	);
	}
}
