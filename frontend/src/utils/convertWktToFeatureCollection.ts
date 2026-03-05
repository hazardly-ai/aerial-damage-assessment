import type { Feature, FeatureCollection, Polygon } from "geojson";

interface WKTInput {
	wkt: string;
	properties?: Record<string, unknown>;
}

function parsePolygonWKT(wkt: string): number[][][] {
	const match = wkt.match(/^POLYGON\s*\(\((.+)\)\)$/i);
	if (!match) {
		throw new Error("Invalid or unsupported WKT (Polygon only)");
	}

	const coordinates = match[1]
		.split(",")
		.map((pair) => pair.trim().split(/\s+/).map(Number));

	return [coordinates];
}

export function convertWKTToFeatureCollection(
	input: WKTInput[],
): FeatureCollection<Polygon> {
	const features: Feature<Polygon>[] = input.map((item, index) => ({
		type: "Feature",

		// Assign unique id
		id: index,

		geometry: {
			type: "Polygon",
			coordinates: parsePolygonWKT(item.wkt),
		},

		properties: item.properties ?? {},
	}));

	return {
		type: "FeatureCollection",
		features,
	};
}
