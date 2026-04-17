import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import MapPage from "@/pages/MapPage.tsx";

export default function App() {
	return (
		<Routes>
			<Route path="/dashboard" element={<Dashboard />} />

			<Route path="/:disaster_name/:xbdid" element={<MapPage />} />

			<Route path="/" element={<MapPage />} />

			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}
