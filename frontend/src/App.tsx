import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import MapPage from "@/pages/MapPage.tsx";

export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Dashboard />} />
			<Route path="/dashboard" element={<Navigate to="/" replace />} />
			<Route path="/map/:disaster_name/:xbdid" element={<MapPage />} />
			<Route path="/map" element={<MapPage />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}
