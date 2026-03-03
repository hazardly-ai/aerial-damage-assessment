import type { Feature, FeatureCollection, Geometry } from "geojson";
import wellknown from "wellknown";

export function convertWKTToFeatureCollection(
	buildings: Array<{
		wkt: string;
		properties?: Record<string, unknown>;
	}>,
): FeatureCollection {
	const features: Feature<Geometry>[] = [];

	for (const building of buildings) {
		const geometry = wellknown.parse(building.wkt) as Geometry;

		if (!geometry) continue;

		// Safely extract id as string if it exists
		const rawId = building.properties?.uid;

		const id =
			typeof rawId === "string" || typeof rawId === "number"
				? rawId
				: undefined;

		features.push({
			type: "Feature",
			id,
			geometry,
			properties: building.properties ?? {},
		});
	}

	return {
		type: "FeatureCollection",
		features,
	};
}
