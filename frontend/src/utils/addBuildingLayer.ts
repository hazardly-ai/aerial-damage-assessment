import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { DAMAGE_COLOR_HEX } from "@/constants/app";

export const BUILDINGS_SOURCE_ID = "buildings-source";
export const BUILDINGS_FILL_LAYER_ID = "buildings-fill";
export const BUILDINGS_OUTLINE_LAYER_ID = "buildings-outline";

const DAMAGE_DEFAULT_HEX = "#ccc";
const OUTLINE_COLOR_DEFAULT = "#ffffff";
const OUTLINE_COLOR_SELECTED = "#ffdf00";

export function getBuildingDamageColor(damage?: string): string {
	if (damage == null || damage === "") return DAMAGE_DEFAULT_HEX;
	return DAMAGE_COLOR_HEX[damage] ?? DAMAGE_DEFAULT_HEX;
}

export function addBuildingLayer(map: MapboxMap, geojson: FeatureCollection) {
	if (!map.getStyle()) return;

	if (!map.getSource(BUILDINGS_SOURCE_ID)) {
		map.addSource(BUILDINGS_SOURCE_ID, {
			type: "geojson",
			data: geojson,
			generateId: true,
		});
	} else {
		const source = map.getSource(BUILDINGS_SOURCE_ID) as GeoJSONSource;
		source.setData(geojson);
	}

	if (!map.getLayer(BUILDINGS_FILL_LAYER_ID)) {
		map.addLayer({
			id: BUILDINGS_FILL_LAYER_ID,
			type: "fill",
			source: BUILDINGS_SOURCE_ID,
			paint: {
				"fill-color": [
					"match",
					["get", "predicted_damage"],
					"no-damage",
					DAMAGE_COLOR_HEX["no-damage"],
					"minor-damage",
					DAMAGE_COLOR_HEX["minor-damage"],
					"major-damage",
					DAMAGE_COLOR_HEX["major-damage"],
					"destroyed",
					DAMAGE_COLOR_HEX.destroyed,
					"un-classified",
					DAMAGE_COLOR_HEX["un-classified"],
					DAMAGE_DEFAULT_HEX,
				],
				"fill-opacity": [
					"case",
					[
						"any",
						["boolean", ["feature-state", "hover"], false],
						["boolean", ["feature-state", "selected"], false],
					],
					0.7,
					0.4,
				],
			},
		});
	}

	// Line layer after fill (no beforeId) so the stroke draws on top of the polygon.
	if (!map.getLayer(BUILDINGS_OUTLINE_LAYER_ID)) {
		map.addLayer({
			id: BUILDINGS_OUTLINE_LAYER_ID,
			type: "line",
			source: BUILDINGS_SOURCE_ID,
			paint: {
				"line-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					OUTLINE_COLOR_SELECTED,
					OUTLINE_COLOR_DEFAULT,
				],
				"line-width": [
					"case",
					[
						"any",
						["boolean", ["feature-state", "hover"], false],
						["boolean", ["feature-state", "selected"], false],
					],
					3.5,
					1.5,
				],
			},
		});
	}
}
