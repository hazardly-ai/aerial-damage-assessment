import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],

	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			// Fix for mapbox-gl-compare (EventEmitter issue)
			events: "events/",
		},
	},

	optimizeDeps: {
		// Force Vite to properly pre-bundle compare
		include: ["mapbox-gl-compare"],
	},

	build: {
		// Ensure CommonJS inside compare is handled
		commonjsOptions: {
			include: [/mapbox-gl-compare/, /node_modules/],
		},
	},

	server: {
		port: 5173,
	},
});
