import type { Feature, FeatureCollection } from "geojson";
import mapboxgl from "mapbox-gl";
import Compare from "mapbox-gl-compare";
import type { MutableRefObject } from "react";

import {
	addBuildingLayer,
	BUILDINGS_FILL_LAYER_ID,
	BUILDINGS_OUTLINE_LAYER_ID,
	BUILDINGS_SOURCE_ID,
	getBuildingDamageColor,
} from "@/utils/addBuildingLayer";

type ImageCoordinates = [
	[number, number],
	[number, number],
	[number, number],
	[number, number],
];

export const PRE_IMAGE_LAYER_ID = "pre-layer";
export const POST_IMAGE_LAYER_ID = "post-layer";
const SATELLITE_BASE_LAYER_ID = "satellite";
const SATELLITE_DIMMED_OPACITY = 0.4;
const SATELLITE_FULL_OPACITY = 1;

export interface PopupData {
	uid: string;
	damage?: string;
	damageColor: string;
	lngLat: mapboxgl.LngLat;
}

export const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

export const setBuildingVisibility = (map: mapboxgl.Map, visible: boolean) => {
	const visibility = visible ? "visible" : "none";
	map.setLayoutProperty(BUILDINGS_FILL_LAYER_ID, "visibility", visibility);
	map.setLayoutProperty(BUILDINGS_OUTLINE_LAYER_ID, "visibility", visibility);
};

export const setImageryVisibility = (
	map: mapboxgl.Map,
	layerId: string,
	visible: boolean,
) => {
	map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
};

export const setSatelliteOpacity = (
	map: mapboxgl.Map,
	imageryVisible: boolean,
) => {
	map.setPaintProperty(
		SATELLITE_BASE_LAYER_ID,
		"raster-opacity",
		imageryVisible ? SATELLITE_DIMMED_OPACITY : SATELLITE_FULL_OPACITY,
	);
};

export function createMapInstance(
	container: HTMLElement,
	imageryVisibleRef: MutableRefObject<boolean>,
) {
	const map = new mapboxgl.Map({
		container,
		style: "mapbox://styles/mapbox/satellite-v9",
		renderWorldCopies: false,
	});

	map.on("style.load", () =>
		setSatelliteOpacity(map, imageryVisibleRef.current),
	);
	map.on("error", (e) => console.error("Mapbox error:", e));
	map.addControl(new mapboxgl.NavigationControl(), "top-right");

	return map;
}

export function waitForMapsLoad(
	beforeMap: mapboxgl.Map,
	afterMap: mapboxgl.Map,
) {
	return Promise.all([
		new Promise<void>((resolve) => beforeMap.on("load", () => resolve())),
		new Promise<void>((resolve) => afterMap.on("load", () => resolve())),
	]);
}

export function addInitialSourcesAndLayers(params: {
	beforeMap: mapboxgl.Map;
	afterMap: mapboxgl.Map;
	preImageUrl: string;
	postImageUrl: string;
	coordinates: ImageCoordinates;
	buildings: FeatureCollection;
}) {
	const {
		beforeMap,
		afterMap,
		preImageUrl,
		postImageUrl,
		coordinates,
		buildings,
	} = params;

	beforeMap.addSource("pre-image", {
		type: "image",
		url: preImageUrl,
		coordinates,
	});
	beforeMap.addLayer({
		id: PRE_IMAGE_LAYER_ID,
		type: "raster",
		source: "pre-image",
	});

	afterMap.addSource("post-image", {
		type: "image",
		url: postImageUrl,
		coordinates,
	});
	afterMap.addLayer({
		id: POST_IMAGE_LAYER_ID,
		type: "raster",
		source: "post-image",
	});

	addBuildingLayer(beforeMap, buildings);
	addBuildingLayer(afterMap, buildings);
}

export function bindBuildingInteractions(params: {
	beforeMap: mapboxgl.Map;
	afterMap: mapboxgl.Map;
	onPopupOpen: (data: PopupData) => void;
	onPopupPositionUpdate: () => void;
	selectedBuildingIdRef: MutableRefObject<string | number | null>;
}) {
	const {
		beforeMap,
		afterMap,
		onPopupOpen,
		onPopupPositionUpdate,
		selectedBuildingIdRef,
	} = params;

	afterMap.on("move", onPopupPositionUpdate);

	let hoveredId: string | number | null = null;

	const setHoverOnBoth = (id: string | number, hover: boolean) => {
		beforeMap.setFeatureState({ source: BUILDINGS_SOURCE_ID, id }, { hover });
		afterMap.setFeatureState({ source: BUILDINGS_SOURCE_ID, id }, { hover });
	};

	const clearHover = () => {
		if (hoveredId === null) return;
		setHoverOnBoth(hoveredId, false);
		hoveredId = null;
	};

	const bindHover = (activeMap: mapboxgl.Map) => {
		activeMap.on("mousemove", BUILDINGS_FILL_LAYER_ID, (e) => {
			const feature = e.features?.[0];
			if (
				!feature ||
				(typeof feature.id !== "string" && typeof feature.id !== "number")
			) {
				return;
			}

			activeMap.getCanvas().style.cursor = "pointer";
			const next = feature.id;
			if (hoveredId === next) return;
			if (hoveredId !== null) setHoverOnBoth(hoveredId, false);
			hoveredId = next;
			setHoverOnBoth(next, true);
		});

		activeMap.on("mouseleave", BUILDINGS_FILL_LAYER_ID, () => {
			activeMap.getCanvas().style.cursor = "";
			clearHover();
		});
	};

	const handleBuildingClick = (
		e: mapboxgl.MapMouseEvent & { features?: Feature[] },
	) => {
		const feature = e.features?.[0];
		if (
			!feature ||
			(typeof feature.id !== "string" && typeof feature.id !== "number")
		) {
			return;
		}

		const uid = asString(feature.properties?.uid);
		if (!uid) return;

		const featureId = feature.id;
		const prev = selectedBuildingIdRef.current;
		if (prev !== null && prev !== featureId) {
			beforeMap.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id: prev },
				{ selected: false },
			);
			afterMap.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id: prev },
				{ selected: false },
			);
		}

		selectedBuildingIdRef.current = featureId;
		beforeMap.setFeatureState(
			{ source: BUILDINGS_SOURCE_ID, id: featureId },
			{ selected: true },
		);
		afterMap.setFeatureState(
			{ source: BUILDINGS_SOURCE_ID, id: featureId },
			{ selected: true },
		);

		const damage = asString(feature.properties?.predicted_damage);
		const damageColor = getBuildingDamageColor(damage);
		onPopupOpen({ uid, damage, damageColor, lngLat: e.lngLat });
	};

	bindHover(beforeMap);
	bindHover(afterMap);
	beforeMap.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);
	afterMap.on("click", BUILDINGS_FILL_LAYER_ID, handleBuildingClick);
}

export function createCompareInstance(params: {
	beforeMap: mapboxgl.Map;
	afterMap: mapboxgl.Map;
	container: HTMLElement;
}) {
	const compare = new Compare(
		params.beforeMap,
		params.afterMap,
		params.container,
	) as Compare & {
		_mapB: mapboxgl.Map;
		_getX: (e: MouseEvent | TouchEvent) => number;
	};

	compare._getX = function (e) {
		const touch = (e as TouchEvent).touches;
		const ev = touch ? touch[0] : (e as MouseEvent);
		const freshBounds = this._mapB.getContainer().getBoundingClientRect();
		let x = ev.clientX - freshBounds.left;
		if (x < 0) x = 0;
		if (x > freshBounds.width) x = freshBounds.width;
		return x;
	};

	return compare;
}
