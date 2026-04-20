import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Dashboard from "@/pages/Dashboard";
import MapPage from "@/pages/MapPage.tsx";
import VlmEvaluationPage from "@/pages/VlmEvaluationPage";

export default function App() {
	return (
		<>
			<Toaster position="bottom-center" richColors closeButton />

			<Routes>
				{/* Core pages */}
				<Route path="/" element={<Dashboard />} />
				<Route path="/dashboard" element={<Navigate to="/" replace />} />

				{/* Map routes */}
				<Route path="/map/:disaster_name?/:xbdid?" element={<MapPage />} />
				<Route path="/map" element={<MapPage />} />

				{/* VLM Route*/}
				<Route path="/vlm" element={<VlmEvaluationPage />} />

				{/* fallback */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</>
	);
}
