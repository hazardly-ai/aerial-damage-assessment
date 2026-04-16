import { Navigate, Route, Routes } from "react-router-dom";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant";
import MapView from "@/components/features/MapView";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import Dashboard from "@/pages/Dashboard";

function HomePage() {
	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			<Header />

			<div className="flex-1 relative w-full max-w-[1600px] mx-auto px-6 py-4 min-h-[75vh]">
				<MapView />
			</div>

			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}

export default function App() {
	return (
		<Routes>
			<Route path="/dashboard" element={<Dashboard />} />

			<Route path="/:disaster_name/:xbdid" element={<HomePage />} />

			<Route path="/" element={<HomePage />} />

			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}
