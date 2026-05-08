import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster, toast } from "sonner";
import Dashboard from "@/pages/Dashboard";

const MapPage = lazy(() => import("@/pages/MapPage.tsx"));

function NotFoundRedirect() {
	useEffect(() => {
		toast.warning("Page not found. Redirected to the dashboard.", {
			id: "route-not-found",
		});
	}, []);

	return <Navigate to="/" replace />;
}

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
					<Route path="*" element={<NotFoundRedirect />} />
				</Routes>
			</Suspense>
		</>
	);
}
