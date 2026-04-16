/**
 * hazardlyApi.ts
 * API client utility for the Hazardly backend.
 * All functions throw on non-OK responses so callers can catch and surface errors.
 */

const API_BASE_URL = import.meta.env.VITE_HAZARDLY_API_BASE_URL?.replace(
	/\/$/,
	"",
);
if (!API_BASE_URL) {
	throw new Error("Missing VITE_HAZARDLY_API_BASE_URL");
}
const IMAGE_BASE_URL = import.meta.env.VITE_HAZARDLY_IMAGE_BASE_URL?.replace(
	/\/$/,
	"",
);
if (!IMAGE_BASE_URL) {
	throw new Error("Missing VITE_HAZARDLY_IMAGE_BASE_URL");
}

// Response shape types

/**
 * A single disaster entry returned by the `/disasters` endpoint.
 */
export interface DisasterSummary {
	id: number;
	name: string;
	type: string;
}

/**
 * Array response returned by `GET /disasters`.
 */
export type DisastersResponse = DisasterSummary[];

/**
 * Affine transform mapping pixel coordinates (u, v) to WGS-84 (lon, lat):
 *
 * ```
 * lon = a·u + b·v + c
 * lat = d·u + e·v + f
 * ```
 *
 * The coefficients are fitted server-side from building pixel/latitude longitude
 * correspondences, so they are always present and can be used directly in
 * {@link computeImageBounds}.
 */
export interface GeoRefineAffine {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

/**
 * Metadata for a pre/post-disaster satellite image pair.
 *
 * - `xbd_id` — unique identifier for this pair within its disaster.
 * - `pre_image_path` / `post_image_path` — storage-relative paths; pass to
 *   {@link resolveImageUrl} to obtain full URLs.
 * - `width` / `height` — image dimensions in pixels.
 * - `geo_refine_affine` — affine transform for pixel→WGS-84 conversion;
 *   consumed by {@link computeImageBounds}.
 */
export interface ImagePairProperties {
	xbd_id: number;
	pre_image_path: string;
	post_image_path: string;
	width: number; // image width in pixels
	height: number; // image height in pixels
	geo_refine_affine: GeoRefineAffine;
	[key: string]: unknown;
}

/**
 * Resolves a storage-relative image path to its fully-qualified URL.
 *
 * @param path - The relative path as returned in {@link ImagePairProperties}
 *   (`pre_image_path` or `post_image_path`).
 * @returns The absolute URL pointing to the image in Supabase Storage.
 *
 * @example
 * ```ts
 * const url = resolveImageUrl(pair.properties.pre_image_path);
 * // → "https://…supabase.co/storage/v1/object/public/satellite-images/foo.png"
 * ```
 */
export const resolveImageUrl = (path: string): string =>
	`${IMAGE_BASE_URL}/${path}`;

/**
 * A single pre/post image pair in GeoJSON Feature format.
 * The `properties` field carries the full {@link ImagePairProperties} payload.
 */
export interface ImagePairFeature {
	type: "Feature";
	properties: ImagePairProperties;
	geometry: unknown;
}

/**
 * GeoJSON FeatureCollection returned by the `/disasters/:id/image-pairs` endpoint.
 * Each feature describes one satellite image pair for the given disaster.
 */
export interface ImagePairsResponse {
	type: "FeatureCollection";
	features: ImagePairFeature[];
}

/** Response from `GET /disasters/:disasterId/image-pairs/xbd-ids`. */
export interface XbdIdsResponse {
	xbd_ids: number[];
}

/**
 * Properties for a single building detected within an image pair.
 *
 * - `uid` — stable identifier for the building across pre/post images.
 * - `predicted_damage` — model-predicted damage class (e.g. `"major-damage"`).
 * - `actual_damage` — ground-truth label when available.
 */
export interface BuildingProperties {
	uid: string;
	predicted_damage?: string;
	actual_damage?: string;
	[key: string]: unknown;
}

/**
 * A single building polygon in GeoJSON Feature format.
 * `geometry` is a standard GeoJSON geometry (typically `Polygon`).
 */
export interface BuildingFeature {
	type: "Feature";
	id?: string | number;
	properties: BuildingProperties;
	geometry: GeoJSON.Geometry;
}

/**
 * GeoJSON FeatureCollection returned by the
 * `/disasters/:id/image-pairs/:xbdId/buildings` endpoint.
 * Each feature represents one building footprint with optional damage labels.
 */
export interface BuildingsResponse {
	type: "FeatureCollection";
	features: BuildingFeature[];
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Geographic bounding information derived from an image pair's affine transform.
 *
 * - `bbox` — axis-aligned envelope as `[minLng, minLat, maxLng, maxLat]`
 *   (compatible with Mapbox / Turf / GeoJSON conventions).
 * - `coordinates` — the four pixel-corner positions in WGS-84, ordered
 *   **top-left → top-right → bottom-right → bottom-left** as required by the
 *   Mapbox GL JS `ImageSource` `coordinates` property.
 * - `sw` / `ne` — convenience south-west and north-east corners as
 *   `[lng, lat]` pairs, suitable for constructing a `LngLatBounds`.
 *   @author James Harrison
 */
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
 * Derives geographic bounds for a satellite image by projecting its four
 * pixel corners through the server-fitted affine transform.
 *
 * The affine maps pixel `(u, v)` → WGS-84 `(lon, lat)`:
 * ```
 * lon = a·u + b·v + c
 * lat = d·u + e·v + f
 * ```
 *
 * @param props - The {@link ImagePairProperties} for the image, which must
 *   contain `width`, `height`, and a valid `geo_refine_affine`.
 * @returns An {@link ImageBounds} object with a bbox, Mapbox-compatible corner
 *   coordinates, and sw/ne convenience points.
 *   @author James Harrison
 *   @author Nishil Jaiswal
 */
export function computeImageBounds(props: ImagePairProperties): ImageBounds {
	const { width: w, height: h, geo_refine_affine: r } = props;

	if (!r) {
		throw new Error(
			"API response missing geo_refine_affine data - image georeferencing not available",
		);
	}

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

/**
 * Internal wrapper around `fetch` that prepends {@link API_BASE_URL}, checks for
 * non-OK HTTP status codes, and deserializes the JSON response body.
 *
 * @param path - API path (must start with `/`).
 * @param options - Optional fetch options (e.g. an `AbortSignal`).
 * @param context - Optional context for error messages.
 * @returns Parsed response body typed as `T`.
 * @throws `Error` with status code and status text if the response is not OK.
 * @author James Harrison
 * @author Nishil Jaiswal
 */
async function apiFetch<T>(
	path: string,
	options?: ApiFetchOptions,
	context?: string,
): Promise<T> {
	const res = await fetch(`${API_BASE_URL}${path}`, {
		signal: options?.signal,
	});
	if (!res.ok) {
		const message = context
			? `${context}: API error ${res.status} for ${path}: ${res.statusText}`
			: `API error ${res.status} for ${path}: ${res.statusText}`;
		throw new Error(message);
	}
	return (await res.json()) as T;
}

// ─── Public API functions ────────────────────────────────────────────────────

/**
 * Fetches the list of all disaster events.
 *
 * Calls `GET /disasters`.
 *
 * @returns A {@link DisastersResponse} array of disasters.
 * @throws `Error` on network failure or a non-OK HTTP response.
 * @author James Harrison
 */
export const fetchDisasters = (): Promise<DisastersResponse> =>
	apiFetch<DisastersResponse>(
		"/disasters",
		undefined,
		"Failed to fetch disasters",
	);

/**
 * Fetches all satellite image pairs associated with a given disaster.
 *
 * Calls `GET /disasters/:disasterId/image-pairs`.
 *
 * @param disasterId - Numeric ID of the disaster (see {@link DisasterSummary}).
 * @param options - Optional fetch options (e.g. an `AbortSignal`).
 * @returns An {@link ImagePairsResponse} GeoJSON FeatureCollection.
 * @throws `Error` on network failure or a non-OK HTTP response.
 * @author James Harrison
 * @author Nishil Jaiswal
 */
export const fetchImagePairs = (
	disasterId: number,
	options?: ApiFetchOptions,
): Promise<ImagePairsResponse> =>
	apiFetch<ImagePairsResponse>(
		`/disasters/${disasterId}/image-pairs`,
		options,
		`Failed to fetch image pairs for disaster ${disasterId}`,
	);

/**
 * Fetches sorted XBD ids for a disaster (lightweight; no GeoJSON or pair metadata).
 *
 * Calls `GET /disasters/:disasterId/image-pairs/xbd-ids`.
 */
export const fetchImagePairXbdIds = (
	disasterId: number,
	options?: ApiFetchOptions,
): Promise<XbdIdsResponse> =>
	apiFetch<XbdIdsResponse>(
		`/disasters/${disasterId}/image-pairs/xbd-ids`,
		options,
		`Failed to fetch image pair ids for disaster ${disasterId}`,
	);

/**
 * Fetches a single satellite image pair by its XBD identifier.
 *
 * Calls `GET /disasters/:disasterId/image-pairs/:xbdId`.
 *
 * @param disasterId - Numeric ID of the parent disaster.
 * @param xbdId - Numeric XBD identifier of the image pair
 *   (see {@link ImagePairProperties.xbd_id}).
 * @param options - Optional fetch options (e.g. an `AbortSignal`).
 * @returns The matching {@link ImagePairFeature}.
 * @throws `Error` on network failure or a non-OK HTTP response.
 * @author James Harrison
 */
export const fetchImagePair = (
	disasterId: number,
	xbdId: number,
	options?: ApiFetchOptions,
): Promise<ImagePairFeature> =>
	apiFetch<ImagePairFeature>(
		`/disasters/${disasterId}/image-pairs/${xbdId}`,
		options,
		`Failed to fetch image pair ${xbdId} for disaster ${disasterId}`,
	);

/**
 * Fetches building footprints and damage assessments for a specific image pair.
 *
 * Calls `GET /disasters/:disasterId/image-pairs/:xbdId/buildings`.
 *
 * @param disasterId - Numeric ID of the parent disaster.
 * @param xbdId - Numeric XBD identifier of the image pair.
 * @param options - Optional fetch options (e.g. an `AbortSignal`).
 * @returns A {@link BuildingsResponse} GeoJSON FeatureCollection where each
 *   feature is one building polygon with optional damage labels.
 * @throws `Error` on network failure or a non-OK HTTP response.
 * @author James Harrison
 */
export const fetchBuildings = (
	disasterId: number,
	xbdId: number,
	options?: ApiFetchOptions,
): Promise<BuildingsResponse> =>
	apiFetch<BuildingsResponse>(
		`/disasters/${disasterId}/image-pairs/${xbdId}/buildings`,
		options,
		`Failed to fetch buildings for image pair ${xbdId}, disaster ${disasterId}`,
	);

/**
 * Convenience function that fetches an image pair and its buildings in parallel,
 * then computes the image's geographic bounds.
 *
 * Internally issues two concurrent requests via `Promise.all`:
 * - {@link fetchImagePair}
 * - {@link fetchBuildings}
 *
 * @param disasterId - Numeric ID of the parent disaster.
 * @param xbdId - Numeric XBD identifier of the image pair.
 * @param options - Optional fetch options (e.g. a shared `AbortSignal`).
 * @returns An object containing:
 *   - `imagePair` — the {@link ImagePairFeature} with full metadata.
 *   - `buildings` — the {@link BuildingsResponse} for that pair.
 *   - `bounds` — pre-computed {@link ImageBounds} derived from the affine transform.
 * @throws `Error` if either request fails.
 * @author James Harrison
 */
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
