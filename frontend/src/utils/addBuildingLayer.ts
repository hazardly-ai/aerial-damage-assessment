import type { FeatureCollection, Polygon } from "geojson";
import type mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";

const SOURCE_ID = "buildings";
const FILL_LAYER_ID = "building-fill";
const LINE_LAYER_ID = "building-outline";

export function addBuildingLayer(
	map: mapboxgl.Map,
	data: FeatureCollection<Polygon>,
) {
	if (!map.getSource(SOURCE_ID)) {
		map.addSource(SOURCE_ID, {
			type: "geojson",
			data,
		});

		map.addLayer({
			id: FILL_LAYER_ID,
			type: "fill",
			source: SOURCE_ID,
			paint: {
				"fill-color": "#ff4d4d",
				"fill-opacity": 0.3,
			},
		});

		map.addLayer({
			id: LINE_LAYER_ID,
			type: "line",
			source: SOURCE_ID,
			paint: {
				"line-color": "#ffffff",
				"line-width": 2,
			},
		});
	} else {
		const source = map.getSource(SOURCE_ID) as GeoJSONSource;
		source.setData(data);
	}
}
