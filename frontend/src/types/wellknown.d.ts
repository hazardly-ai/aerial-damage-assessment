declare module "wellknown" {
	export function parse(wkt: string): unknown;
	export function stringify(geojson: unknown): string;

	const wellknown: {
		parse: (wkt: string) => unknown;
		stringify: (geojson: unknown) => string;
	};

	export default wellknown;
}
