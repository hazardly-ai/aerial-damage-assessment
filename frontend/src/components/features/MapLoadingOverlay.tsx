interface MapLoadingOverlayProps {
	show: boolean;
	fading: boolean;
}

/**
 * Full-bleed overlay shown while the map is loading.
 * Visibility and fade-out timing are controlled by the useLoadingOverlay hook.
 */
export function MapLoadingOverlay({ show, fading }: MapLoadingOverlayProps) {
	if (!show) return null;

	return (
		<div
			className="map-status-overlay map-status-overlay--loading"
			data-fading={fading ? "true" : undefined}
			aria-live="polite"
		>
			<span className="map-status-spinner" aria-hidden="true" />
			<p>Loading map data…</p>
		</div>
	);
}
