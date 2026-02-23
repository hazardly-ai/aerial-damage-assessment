import { useEffect, useRef, useState } from "react";
import MapView from "@/components/MapView";
import { Button } from "@/components/ui/button";
import { ChatWidget } from "@/components/ui/ChatWidget";
import Footer from "@/components/layout/Footer";
import ThemeToggle from "@/components/ui/ThemeToggle";
import {
	APP_NAME,
} from "@/constants/app"

export default function App() {
	const [preImage, setPreImage] = useState<File | null>(null);
	const [postImage, setPostImage] = useState<File | null>(null);
	const [preURL, setPreURL] = useState<string | null>(null);
	const [postURL, setPostURL] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<"pre" | "post" | "slider">("slider");
	const [sliderX, setSliderX] = useState(0);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const handleRef = useRef<HTMLDivElement | null>(null);

	// Generate object URLs
	useEffect(() => {
		if (preImage) setPreURL(URL.createObjectURL(preImage));
		if (postImage) setPostURL(URL.createObjectURL(postImage));

		return () => {
			if (preURL) URL.revokeObjectURL(preURL);
			if (postURL) URL.revokeObjectURL(postURL);
		};
	}, [preImage, postImage]);

	// Reset slider when switching modes
	useEffect(() => {
		if (viewMode === "slider" && containerRef.current) {
			setSliderX(containerRef.current.offsetWidth / 2);
		}
	}, [viewMode, preURL, postURL]);

	// Slider drag logic
	useEffect(() => {
		if (!handleRef.current || !containerRef.current) return;
		let isDragging = false;

		const onMouseDown = () => (isDragging = true);
		const onMouseUp = () => (isDragging = false);
		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			const rect = containerRef.current!.getBoundingClientRect();
			let x = e.clientX - rect.left;
			if (x < 0) x = 0;
			if (x > rect.width) x = rect.width;
			setSliderX(x);
		};

		handleRef.current.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("mousemove", onMouseMove);

		return () => {
			handleRef.current?.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("mousemove", onMouseMove);
		};
	}, [preURL, postURL]);

	return (
		<div className="flex flex-col min-h-screen bg-background text-foreground">

			{/* Header */}
			{/* Header */}
			<div className="z-10 bg-background/95 backdrop-blur border-b border-border">
				<div className="mx-auto max-w-6xl px-6 py-8">
					<div className="flex justify-between items-start gap-6">
						<header className="space-y-3">

							<p className="text-sm uppercase tracking-[0.35em] text-muted-foreground">
								{APP_NAME}
							</p>

							<h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
								Rapid post-disaster insights from aerial imagery.
							</h1>

							<p className="max-w-2xl text-base text-muted-foreground">
								Inspect, quantify, and triage damage with a unified dashboard
								combining satellite imagery and AI damage detection.
							</p>

						</header>

						<ThemeToggle />
					</div>
				</div>
			</div>

			{/* Upload + Controls */}
			<div className="flex flex-col items-center px-6 py-8 gap-8">
				<div className="flex flex-wrap justify-center gap-6">
					<div className="flex flex-col items-start">
						<label className="block text-sm font-medium text-muted-foreground">
							Pre-disaster Image
						</label>
						<input
							type="file"
							accept="image/*"
							onChange={(e) =>
								setPreImage(e.target.files ? e.target.files[0] : null)
							}
							className="mt-1"
						/>
					</div>

					<div className="flex flex-col items-start">
						<label className="block text-sm font-medium text-muted-foreground">
							Post-disaster Image
						</label>
						<input
							type="file"
							accept="image/*"
							onChange={(e) =>
								setPostImage(e.target.files ? e.target.files[0] : null)
							}
							className="mt-1"
						/>
					</div>
				</div>

				<div className="flex gap-2">
					<Button
						variant={viewMode === "pre" ? "default" : "outline"}
						onClick={() => setViewMode("pre")}
					>
						Show Pre
					</Button>

					<Button
						variant={viewMode === "post" ? "default" : "outline"}
						onClick={() => setViewMode("post")}
					>
						Show Post
					</Button>

					<Button
						variant={viewMode === "slider" ? "default" : "outline"}
						onClick={() => setViewMode("slider")}
					>
						Slider
					</Button>
				</div>

				{/* Slider */}
				<div
					ref={containerRef}
					className="relative w-full max-w-3xl h-64 overflow-hidden rounded-xl border border-border bg-card select-none"
				>
					{preURL && (
						<img
							src={preURL}
							alt="Pre"
							className="absolute top-0 left-0 w-full h-full object-cover"
							style={{ opacity: viewMode === "post" ? 0 : 1 }}
						/>
					)}

					{postURL && (
						<img
							src={postURL}
							alt="Post"
							className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300"
							style={{
								opacity: viewMode === "pre" ? 0 : 1,
								clipPath:
									viewMode === "slider" && containerRef.current
										? `inset(0 ${
											100 - (sliderX / containerRef.current.offsetWidth) * 100
										}% 0 0)`
										: "inset(0 0 0 0)",
							}}
						/>
					)}

					<div
						ref={handleRef}
						className={`absolute top-0 -translate-x-1/2 w-2 h-full bg-white border border-gray-400 cursor-ew-resize ${
							viewMode === "slider" ? "" : "opacity-0 pointer-events-none"
						}`}
						style={{ left: sliderX }}
					/>
				</div>
			</div>

			{/* Map Section */}
			<div className="flex-1 relative w-full max-w-5xl mx-auto">
				<MapView />
			</div>

			{/* Chat Widget */}
			<ChatWidget />

			{/* Footer */}
			<Footer />
		</div>
	);
}