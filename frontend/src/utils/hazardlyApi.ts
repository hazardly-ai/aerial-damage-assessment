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

/** lon = a*u + b*v + c, lat = d*u + e*v + f (pixel u,v → WGS84), optional fit from buildings */
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
	geo_origin_lon: number;
	geo_origin_lat: number;
	geo_pixel_width: number;
	geo_pixel_height: number;
	width: number; // image width in pixels
	height: number; // image height in pixels
	geo_refine_affine?: GeoRefineAffine | null;
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

type MetaBounds = {
	coordinates: ImageBounds["coordinates"];
	iMinLng: number;
	iMaxLng: number;
	iMinLat: number;
	iMaxLat: number;
};

function extractBuildingCoords(buildings: BuildingsResponse): number[][] {
	return buildings.features.flatMap((f) => {
		const geom = f.geometry;

		if (geom.type === "Polygon") {
			return geom.coordinates[0] as number[][];
		}

		if (geom.type === "MultiPolygon") {
			return (geom.coordinates as number[][][][]).flatMap((p) => p[0]);
		}

		return [];
	});
}

function computeBounds(coords: number[][]) {
	const lngs = coords.map((c) => c[0]);
	const lats = coords.map((c) => c[1]);

	const minLng = Math.min(...lngs);
	const maxLng = Math.max(...lngs);
	const minLat = Math.min(...lats);
	const maxLat = Math.max(...lats);

	return { minLng, maxLng, minLat, maxLat };
}

function isGeoRefineAffine(
	r: GeoRefineAffine | null | undefined,
): r is GeoRefineAffine {
	if (!r) return false;
	const n = [r.a, r.b, r.c, r.d, r.e, r.f];
	return n.every((x) => Number.isFinite(x));
}

/**
 * Image quad: optional footprint-fitted affine (`geo_refine_affine`), else GDAL
 * envelope from origin + width*geo_pixel_width / +height*geo_pixel_height.
 */
function computeImageBoundsFromMeta(props: ImagePairProperties): MetaBounds {
	const w = props.width;
	const h = props.height;
	const refine = props.geo_refine_affine;

	let coordinates: ImageBounds["coordinates"];

	if (isGeoRefineAffine(refine)) {
		const { a, b, c, d, e, f } = refine;
		const corner = (u: number, v: number): [number, number] => [
			a * u + b * v + c,
			d * u + e * v + f,
		];
		coordinates = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
	} else {
		const lx = props.geo_origin_lon;
		const ly = props.geo_origin_lat;
		const dx = w * props.geo_pixel_width;
		const dy = h * props.geo_pixel_height;
		coordinates = [
			[lx, ly],
			[lx + dx, ly],
			[lx + dx, ly + dy],
			[lx, ly + dy],
		];
	}

	const lngs = coordinates.map((c) => c[0]);
	const lats = coordinates.map((c) => c[1]);
	return {
		coordinates,
		iMinLng: Math.min(...lngs),
		iMaxLng: Math.max(...lngs),
		iMinLat: Math.min(...lats),
		iMaxLat: Math.max(...lats),
	};
}

export function computeImageBounds(
	props: ImagePairProperties,
	buildings: BuildingsResponse,
): ImageBounds {
	const {
		geo_origin_lon,
		geo_origin_lat,
		geo_pixel_width,
		geo_pixel_height,
		width,
		height,
	} = props;

	const hasValidGeo =
		geo_origin_lon != null &&
		geo_origin_lat != null &&
		geo_pixel_width != null &&
		geo_pixel_height != null &&
		width != null &&
		height != null;

	// Fallback: no georeference
	if (!hasValidGeo) {
		const coords = extractBuildingCoords(buildings);

		if (coords.length === 0) {
			return {
				bbox: [0, 0, 0, 0],
				coordinates: [
					[0, 0],
					[0, 0],
					[0, 0],
					[0, 0],
				],
				sw: [0, 0],
				ne: [0, 0],
			};
		}

		const { minLng, maxLng, minLat, maxLat } = computeBounds(coords);

		return {
			bbox: [minLng, minLat, maxLng, maxLat],
			coordinates: [
				[minLng, maxLat],
				[maxLng, maxLat],
				[maxLng, minLat],
				[minLng, minLat],
			],
			sw: [minLng, minLat],
			ne: [maxLng, maxLat],
		};
	}

	// ── Image bounds from metadata ───────────────────────────────────────────
	const coords = extractBuildingCoords(buildings);

	if (coords.length === 0) {
		const { coordinates, iMinLng, iMaxLng, iMinLat, iMaxLat } =
			computeImageBoundsFromMeta(props);

		return {
			bbox: [iMinLng, iMinLat, iMaxLng, iMaxLat],
			coordinates,
			sw: [iMinLng, iMinLat],
			ne: [iMaxLng, iMaxLat],
		};
	}

	const {
		minLng: bMinLng,
		maxLng: bMaxLng,
		minLat: bMinLat,
		maxLat: bMaxLat,
	} = computeBounds(coords);

	const {
		coordinates: imageCoordinates,
		iMinLng,
		iMaxLng,
		iMinLat,
		iMaxLat,
	} = computeImageBoundsFromMeta(props);

	const hasOutOfBoundsBuildings =
		bMinLng < iMinLng ||
		bMaxLng > iMaxLng ||
		bMinLat < iMinLat ||
		bMaxLat > iMaxLat;

	let minLng = iMinLng;
	let maxLng = iMaxLng;
	let minLat = iMinLat;
	let maxLat = iMaxLat;

	if (hasOutOfBoundsBuildings) {
		minLng = Math.min(iMinLng, bMinLng);
		maxLng = Math.max(iMaxLng, bMaxLng);
		minLat = Math.min(iMinLat, bMinLat);
		maxLat = Math.max(iMaxLat, bMaxLat);
	}

	return {
		bbox: [minLng, minLat, maxLng, maxLat],
		coordinates: imageCoordinates,
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

	const bounds = computeImageBounds(imagePair.properties, buildings);
	return { imagePair, buildings, bounds };
}
