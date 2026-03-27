import { useEffect, useState } from "react";
import type { MapStatus } from "@/types/map.ts";

const FADE_DURATION_MS = 400;

interface LoadingOverlayState {
	show: boolean;
	fading: boolean;
}

/**
 * Manages the visibility and fade-out timing of the map loading overlay.
 *
 * - Mounts the overlay immediately when status becomes "loading".
 * - When status becomes "ready", triggers a CSS fade-out, then unmounts
 *   the overlay after FADE_DURATION_MS so the transition can complete.
 */
export function useLoadingOverlay(status: MapStatus): LoadingOverlayState {
	const [show, setShow] = useState(false);
	const [fading, setFading] = useState(false);

	useEffect(() => {
		if (status === "loading") {
			setFading(false);
			setShow(true);
			return;
		}
		if (status === "ready") {
			setFading(true);
			const t = setTimeout(() => {
				setShow(false);
				setFading(false);
			}, FADE_DURATION_MS);
			return () => clearTimeout(t);
		}
	}, [status]);

	return { show, fading };
}
