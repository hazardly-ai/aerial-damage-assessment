/**
 * hazardlyApi.ts
 * API client utility for the Hazardly backend.
 * All functions throw on non-OK responses so callers can catch and surface errors.
 */
import { EXCLUDED_XBD_IDS } from "@/constants/excludedXbdIds.ts";

// import bbox from "@turf/bbox";

const BASE_URL = "https://hazardly-api.vercel.app";
const IMAGE_BASE_URL =
	"https://zbnrjjmqbnqunkjbmsdk.supabase.co/storage/v1/object/public/satellite-images";

// Response shape types

export interface DisasterFeature {
	type: "Feature";
	properties: {
		disaster_id: number;
		name: string;
		[key: string]: unknown;
	};
	geometry: unknown;
}

export interface DisastersResponse {
	type: "FeatureCollection";
	features: DisasterFeature[];
}

export interface ImagePairProperties {
	xbd_id: number;
	pre_image_path: string;
	post_image_path: string;
	geo_origin_lon: number;
	geo_origin_lat: number;
	geo_pixel_width: number;
	geo_pixel_height: number;
	width: number; // image width in pixels
	height: number; // image height in pixels
	[key: string]: unknown;
}

/** Resolve a relative image path to a full URL. */
export const resolveImageUrl = (path: string): string =>
	`${IMAGE_BASE_URL}/${path}`;

export interface ImagePairFeature {
	type: "Feature";
	properties: ImagePairProperties;
	geometry: unknown;
}

export interface ImagePairsResponse {
	type: "FeatureCollection";
	features: ImagePairFeature[];
}

export interface BuildingProperties {
	uid: string;
	predicted_damage?: string;
	actual_damage?: string;
	[key: string]: unknown;
}

export interface BuildingFeature {
	type: "Feature";
	id?: string | number;
	properties: BuildingProperties;
	geometry: GeoJSON.Geometry;
}

export interface BuildingsResponse {
	type: "FeatureCollection";
	features: BuildingFeature[];
}

// Computed bounds helper

export interface ImageBounds {
	/** [minLng, minLat, maxLng, maxLat] */
	bbox: [number, number, number, number];
	/**
	 * Mapbox image-source coordinates in order:
	 * top-left, top-right, bottom-right, bottom-left
	 */
	coordinates: [
		[number, number],
		[number, number],
		[number, number],
		[number, number],
	];
	sw: [number, number];
	ne: [number, number];
}

export function computeImageBounds(
	_props: ImagePairProperties,
	buildings: BuildingsResponse,
): ImageBounds {
	const coords = buildings.features.flatMap((f) => {
		const geom = f.geometry;
		if (geom.type === "Polygon") return geom.coordinates[0] as number[][];
		if (geom.type === "MultiPolygon")
			return (geom.coordinates as number[][][][]).flatMap((p) => p[0]);
		return [];
	});

	const lngs = coords.map((c) => c[0]);
	const lats = coords.map((c) => c[1]);
	const minLng = Math.min(...lngs);
	const maxLng = Math.max(...lngs);
	const minLat = Math.min(...lats);
	const maxLat = Math.max(...lats);

	return {
		bbox: [minLng, minLat, maxLng, maxLat],
		coordinates: [
			[minLng, maxLat], // top-left
			[maxLng, maxLat], // top-right
			[maxLng, minLat], // bottom-right
			[minLng, minLat], // bottom-left
		],
		sw: [minLng, minLat],
		ne: [maxLng, maxLat],
	};
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`);
	if (!res.ok) {
		throw new Error(`API error ${res.status} for ${path}: ${res.statusText}`);
	}
	return res.json() as Promise<T>;
}

// ─── Public API functions ────────────────────────────────────────────────────

/** List all disasters. */
export const fetchDisasters = (): Promise<DisastersResponse> =>
	apiFetch<DisastersResponse>("/disasters");

/**
 * List all image pairs for a disaster.
 * Returns a GeoJSON FeatureCollection; each feature's properties contain xbd_id.
 */
export const fetchImagePairs = async (
	disasterId: number,
): Promise<ImagePairsResponse> => {
	const resp = await apiFetch<ImagePairsResponse>(
		`/disasters/${disasterId}/image-pairs`,
	);
	const excluded = EXCLUDED_XBD_IDS[disasterId] ?? new Set();
	return {
		...resp,
		features: resp.features.filter((f) => !excluded.has(f.properties.xbd_id)),
	};
};

/** Fetch metadata for a single image pair. */
export const fetchImagePair = (
	disasterId: number,
	xbdId: number,
): Promise<ImagePairFeature> =>
	apiFetch<ImagePairFeature>(`/disasters/${disasterId}/image-pairs/${xbdId}`);

/** Fetch building polygons + metadata for a single image pair. */
export const fetchBuildings = (
	disasterId: number,
	xbdId: number,
): Promise<BuildingsResponse> =>
	apiFetch<BuildingsResponse>(
		`/disasters/${disasterId}/image-pairs/${xbdId}/buildings`,
	);

/**
 * Convenience: fetch image-pair metadata and buildings in parallel.
 * Returns everything MapView needs to render a scene.
 *
 * Bounds are derived from the building polygon extents (same approach as the
 * original local-asset code) rather than the geo origin fields, which avoids
 * ambiguity around pixel-center vs pixel-edge conventions.
 */
export async function fetchMapData(disasterId: number, xbdId: number) {
	const [imagePair, buildings] = await Promise.all([
		fetchImagePair(disasterId, xbdId),
		fetchBuildings(disasterId, xbdId),
	]);

	const bounds = computeImageBounds(imagePair.properties, buildings);
	return { imagePair, buildings, bounds };
}
