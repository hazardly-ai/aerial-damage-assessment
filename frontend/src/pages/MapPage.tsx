import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant.tsx";
import MapView from "@/components/features/MapView.tsx";
import Footer from "@/components/layout/Footer.tsx";
import Header from "@/components/layout/Header.tsx";

export default function MapPage() {
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
