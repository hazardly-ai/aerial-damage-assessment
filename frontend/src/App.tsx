import Footer from "@/components/layout/Footer";
import MapView from "@/components/MapView";
import { ChatWidget } from "@/components/ui/ChatWidget";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { TEAM_NAME } from "@/constants/app";

export default function App() {
	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">
			{/* Header */}
			<div className="z-10 bg-background/95 backdrop-blur border-b border-border">
				<div className="mx-auto max-w-6xl px-6 py-8">
					<div className="flex justify-between items-start gap-6">
						<header className="space-y-3">
							<h1 className="text-3xl sm:text-4xl font-bold font-jost tracking-tight leading-tight">
								{TEAM_NAME}
							</h1>
							<p className="text-sm uppercase tracking-[0.35em] text-muted-foreground">
								Post-disaster insights from aerial imagery.
							</p>
							<p className="max-w-2xl text-base text-muted-foreground">
								Inspect, quantify, and triage disaster damage with a unified
								dashboard combining satellite imagery and AI damage
								classification.
							</p>
						</header>

						<ThemeToggle />
					</div>
				</div>
			</div>
			{/* Map Section */}
			<div className="flex-1 relative w-full max-w-5xl mx-auto px-6 py-8">
				<MapView />
			</div>

			{/* Chat Widget */}
			<ChatWidget />

			{/* Footer */}
			<Footer />
		</div>
	);
}
