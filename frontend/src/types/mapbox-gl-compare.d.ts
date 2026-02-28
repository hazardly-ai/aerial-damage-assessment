declare module "mapbox-gl-compare" {
	import mapboxgl from "mapbox-gl";

	export default class Compare {
		constructor(
			beforeMap: mapboxgl.Map,
			afterMap: mapboxgl.Map,
			container: HTMLElement,
			options?: {
				orientation?: "vertical" | "horizontal";
				mousemove?: boolean;
			},
		);
		remove(): void;
	}
}
