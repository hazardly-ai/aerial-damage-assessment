import type { Map as MapboxMap } from "mapbox-gl";

const SOURCE_ID = "buildings-source";
const FILL_LAYER_ID = "buildings-fill";
const OUTLINE_LAYER_ID = "buildings-outline";

export function addBuildingLayer(
	map: MapboxMap,
	geojson: GeoJSON.FeatureCollection,
) {
	if (!map.getStyle()) return;

	if (!map.getSource(SOURCE_ID)) {
		map.addSource(SOURCE_ID, {
			type: "geojson",
			data: geojson,
		});
	} else {
		const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;

		source.setData(geojson);
	}

	if (!map.getLayer(FILL_LAYER_ID)) {
		map.addLayer({
			id: FILL_LAYER_ID,
			type: "fill",
			source: SOURCE_ID,
			paint: {
				"fill-color": "#ff4d4d",
				"fill-opacity": 0.4,
			},
		});
	}

	if (!map.getLayer(OUTLINE_LAYER_ID)) {
		map.addLayer({
			id: OUTLINE_LAYER_ID,
			type: "line",
			source: SOURCE_ID,
			paint: {
				"line-color": "#ffffff",
				"line-width": 2,
			},
		});
	}
}
