import mapboxgl from "mapbox-gl";
import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView() {
	const mapContainer = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!mapContainer.current) return;

		const map = new mapboxgl.Map({
			container: mapContainer.current,
			style: "mapbox://styles/mapbox/satellite-v9",
			center: [-96.797, 32.7767],
			zoom: 12,
		});

		map.addControl(new mapboxgl.NavigationControl(), "top-right");

		return () => map.remove();
	}, []);

	return (
		<div ref={mapContainer} className="w-full h-96 rounded-xl shadow-lg" />
	);
}
