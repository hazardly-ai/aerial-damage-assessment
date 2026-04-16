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
	predictedDamage?: string;
	predictedDamageColor: string;
	actualDamage?: string;
	actualDamageColor: string;
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

class ResetBoundsControl implements mapboxgl.IControl {
	private container?: HTMLDivElement;
	private button?: HTMLButtonElement;

	constructor(private readonly onResetView: () => void) {}

	onAdd() {
		const container = document.createElement("div");
		container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "mapboxgl-ctrl-reset-bounds";
		button.setAttribute("aria-label", "Reset view to scene bounds");
		button.title = "Reset view";

		const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		icon.setAttribute("viewBox", "0 0 24 24");
		icon.setAttribute("fill", "none");
		icon.setAttribute("stroke", "currentColor");
		icon.setAttribute("stroke-width", "2");
		icon.setAttribute("stroke-linecap", "round");
		icon.setAttribute("stroke-linejoin", "round");
		icon.setAttribute("aria-hidden", "true");
		icon.classList.add("mapboxgl-ctrl-reset-bounds__icon");

		for (const [tagName, attrs] of [
			["line", { x1: "2", x2: "5", y1: "12", y2: "12" }],
			["line", { x1: "19", x2: "22", y1: "12", y2: "12" }],
			["line", { x1: "12", x2: "12", y1: "2", y2: "5" }],
			["line", { x1: "12", x2: "12", y1: "19", y2: "22" }],
			["circle", { cx: "12", cy: "12", r: "7" }],
			["circle", { cx: "12", cy: "12", r: "3" }],
		] as const) {
			const element = document.createElementNS(
				"http://www.w3.org/2000/svg",
				tagName,
			);
			for (const [name, value] of Object.entries(attrs)) {
				element.setAttribute(name, value);
			}
			icon.appendChild(element);
		}

		button.appendChild(icon);
		button.addEventListener("click", this.onResetView);
		container.appendChild(button);

		this.container = container;
		this.button = button;

		return container;
	}

	onRemove() {
		if (this.button) {
			this.button.removeEventListener("click", this.onResetView);
		}
		this.container?.remove();
		this.container = undefined;
		this.button = undefined;
	}
}

export function createMapInstance(
	container: HTMLElement,
	imageryVisibleRef: MutableRefObject<boolean>,
	options?: {
		withResetBoundsControl?: boolean;
		onResetView?: () => void;
	},
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
	if (options?.withResetBoundsControl && options.onResetView) {
		map.addControl(new ResetBoundsControl(options.onResetView), "top-right");
	}
	return map;
}

export function waitForMapsLoad(
	beforeMap: mapboxgl.Map,
	afterMap: mapboxgl.Map,
) {
	const waitForMapLoad = (map: mapboxgl.Map) =>
		new Promise<void>((resolve) => {
			if (map.loaded()) {
				resolve();
				return;
			}
			map.once("load", () => resolve());
		});

	return Promise.all([waitForMapLoad(beforeMap), waitForMapLoad(afterMap)]);
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

		const predictedDamage = asString(feature.properties?.predicted_damage);
		const predictedDamageColor = getBuildingDamageColor(predictedDamage);
		const actualDamage = asString(feature.properties?.actual_damage);
		const actualDamageColor = getBuildingDamageColor(actualDamage);
		onPopupOpen({
			uid,
			predictedDamage,
			predictedDamageColor,
			actualDamage,
			actualDamageColor,
			lngLat: e.lngLat,
		});
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
