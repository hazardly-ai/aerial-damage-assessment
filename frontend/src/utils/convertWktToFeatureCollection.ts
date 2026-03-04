import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import wellknown from "wellknown";

type GeoTransform = readonly [number, number, number, number, number, number];

function pixelToGeo(coord: Position, geoTransform: GeoTransform): Position {
	const [originX, pixelWidth, , originY, , pixelHeight] = geoTransform;
	const [col, row] = coord;
	return [originX + col * pixelWidth, originY + row * pixelHeight];
}

export function convertWKTToFeatureCollection(
	buildings: Array<{
		wkt: string;
		properties?: Record<string, unknown>;
	}>,
	geoTransform?: GeoTransform,
): FeatureCollection {
	const features: Feature<Polygon>[] = [];

	for (const building of buildings) {
		const geometry = wellknown.parse(building.wkt) as Polygon | null;

		if (!geometry || geometry.type !== "Polygon") continue;

		const coordinates = geoTransform
			? geometry.coordinates.map((ring) =>
				ring.map((coord) => pixelToGeo(coord, geoTransform)),
			)
			: geometry.coordinates;

		const rawId = building.properties?.uid;
		const id =
			typeof rawId === "string" || typeof rawId === "number"
				? rawId
				: undefined;

		features.push({
			type: "Feature",
			id,
			geometry: { type: "Polygon", coordinates },
			properties: building.properties ?? {},
		});
	}

	return { type: "FeatureCollection", features };
}