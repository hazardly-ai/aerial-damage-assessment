import DisasterResponsesAssistant from "@/components/features/DisasterResponseAssistant";
import MapView from "@/components/features/MapView";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

export default function App() {
	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			<Header />
			{/* Map Section */}
			<div className="flex-1 relative w-full max-w-5xl mx-auto px-6 py-8">
				<MapView />
			</div>

			{/* Chat Widget */}
			{/*<ChatWidget />*/}
			<DisasterResponsesAssistant />
			{/* Footer */}
			<Footer />
		</div>
	);
}
