/**
 * hazardlyApi.ts
 * API client utility for the Hazardly backend.
 * All functions throw on non-OK responses so callers can catch and surface errors.
 */

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

/**
 * Affine transform mapping pixel (u, v) → WGS84 (lon, lat):
 *   lon = a*u + b*v + c
 *   lat = d*u + e*v + f
 *
 * Fitted server-side from building pixel↔latlon correspondences,
 * so it is always present and accurate.
 */
export interface GeoRefineAffine {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export interface ImagePairProperties {
	xbd_id: number;
	pre_image_path: string;
	post_image_path: string;
	width: number; // image width in pixels
	height: number; // image height in pixels
	geo_refine_affine: GeoRefineAffine;
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

// ─── Bounds ──────────────────────────────────────────────────────────────────

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

/**
 * Compute the image bounds from the server-fitted affine transform.
 * Maps the four pixel corners → WGS84 to get the image quad and its
 * axis-aligned envelope.
 */
export function computeImageBounds(props: ImagePairProperties): ImageBounds {
	const { width: w, height: h, geo_refine_affine: r } = props;
	const corner = (u: number, v: number): [number, number] => [
		r.a * u + r.b * v + r.c,
		r.d * u + r.e * v + r.f,
	];

	const coordinates: ImageBounds["coordinates"] = [
		corner(0, 0), // top-left
		corner(w, 0), // top-right
		corner(w, h), // bottom-right
		corner(0, h), // bottom-left
	];

	const lngs = coordinates.map((c) => c[0]);
	const lats = coordinates.map((c) => c[1]);
	const minLng = Math.min(...lngs);
	const maxLng = Math.max(...lngs);
	const minLat = Math.min(...lats);
	const maxLat = Math.max(...lats);

	return {
		bbox: [minLng, minLat, maxLng, maxLat],
		coordinates,
		sw: [minLng, minLat],
		ne: [maxLng, maxLat],
	};
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

interface ApiFetchOptions {
	signal?: AbortSignal;
}

async function apiFetch<T>(
	path: string,
	options?: ApiFetchOptions,
): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, { signal: options?.signal });
	if (!res.ok) {
		throw new Error(`API error ${res.status} for ${path}: ${res.statusText}`);
	}
	return (await res.json()) as Promise<T>;
}

// ─── Public API functions ────────────────────────────────────────────────────

export const fetchDisasters = (): Promise<DisastersResponse> =>
	apiFetch<DisastersResponse>("/disasters");

export const fetchImagePairs = (
	disasterId: number,
	options?: ApiFetchOptions,
): Promise<ImagePairsResponse> =>
	apiFetch<ImagePairsResponse>(`/disasters/${disasterId}/image-pairs`, options);

export const fetchImagePair = (
	disasterId: number,
	xbdId: number,
	options?: ApiFetchOptions,
): Promise<ImagePairFeature> =>
	apiFetch<ImagePairFeature>(
		`/disasters/${disasterId}/image-pairs/${xbdId}`,
		options,
	);

export const fetchBuildings = (
	disasterId: number,
	xbdId: number,
	options?: ApiFetchOptions,
): Promise<BuildingsResponse> =>
	apiFetch<BuildingsResponse>(
		`/disasters/${disasterId}/image-pairs/${xbdId}/buildings`,
		options,
	);

export async function fetchMapData(
	disasterId: number,
	xbdId: number,
	options?: ApiFetchOptions,
) {
	const [imagePair, buildings] = await Promise.all([
		fetchImagePair(disasterId, xbdId, options),
		fetchBuildings(disasterId, xbdId, options),
	]);

	const bounds = computeImageBounds(imagePair.properties);
	return { imagePair, buildings, bounds };
}
