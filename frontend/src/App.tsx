import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Dashboard from "@/pages/Dashboard";

const MapPage = lazy(() => import("@/pages/MapPage.tsx"));

export default function App() {
	return (
		<>
			<Toaster position="bottom-center" richColors closeButton />
			<Suspense fallback={null}>
				<Routes>
					<Route path="/" element={<Dashboard />} />
					<Route path="/dashboard" element={<Navigate to="/" replace />} />
					<Route path="/map/:disaster_name?/:xbdid?" element={<MapPage />} />
					<Route path="/map" element={<MapPage />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</Suspense>
		</>
	);
}
