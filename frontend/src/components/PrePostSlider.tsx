import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface PrePostSliderProps {
	preImage: File | null;
	postImage: File | null;
}

export default function PrePostSlider({
	preImage,
	postImage,
}: PrePostSliderProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const handleRef = useRef<HTMLDivElement | null>(null);

	const [sliderX, setSliderX] = useState(0);
	const [viewMode, setViewMode] = useState<"pre" | "post" | "slider">("slider");
	const [preURL, setPreURL] = useState<string | null>(null);
	const [postURL, setPostURL] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	// Preload images
	useEffect(() => {
		if (!preImage || !postImage) return;

		setLoaded(false);

		const preObj = URL.createObjectURL(preImage);
		const postObj = URL.createObjectURL(postImage);

		const preImg = new Image();
		const postImg = new Image();

		let loadedCount = 0;
		const onLoad = () => {
			loadedCount++;
			if (loadedCount === 2) setLoaded(true);
		};

		preImg.src = preObj;
		postImg.src = postObj;

		preImg.onload = onLoad;
		postImg.onload = onLoad;

		setPreURL(preObj);
		setPostURL(postObj);

		return () => {
			URL.revokeObjectURL(preObj);
			URL.revokeObjectURL(postObj);
		};
	}, [preImage, postImage]);

	// Initialize slider in middle once loaded
	useEffect(() => {
		if (!loaded) return;

		const container = containerRef.current;
		if (!container) return;

		setSliderX(container.offsetWidth / 2);
	}, [loaded]);

	// Drag logic
	useEffect(() => {
		const handle = handleRef.current;
		const container = containerRef.current;
		if (!handle || !container) return;

		let isDragging = false;

		const onMouseDown = () => {
			isDragging = true;
		};

		const onMouseUp = () => {
			isDragging = false;
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;

			const rect = container.getBoundingClientRect();
			let newX = e.clientX - rect.left;

			if (newX < 0) newX = 0;
			if (newX > rect.width) newX = rect.width;

			setSliderX(newX);
		};

		handle.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("mousemove", onMouseMove);

		const handleResize = () => {
			const current = containerRef.current;
			if (!current) return;
			setSliderX(current.offsetWidth / 2);
		};

		window.addEventListener("resize", handleResize);

		return () => {
			handle.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("resize", handleResize);
		};
	}, []);

	if (!preImage || !postImage || !loaded || !preURL || !postURL) {
		return (
			<div className="flex h-64 w-full max-w-3xl items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
				Upload both Pre and Post images to view
			</div>
		);
	}

	const containerWidth = containerRef.current?.offsetWidth ?? 1;
	const clipPercentage = 100 - (sliderX / containerWidth) * 100;

	return (
		<div className="flex w-full flex-col items-center gap-4">
			{/* Toggle Buttons */}
			<div className="flex gap-2">
				<Button
					type="button"
					variant={viewMode === "pre" ? "default" : "outline"}
					onClick={() => setViewMode("pre")}
				>
					Show Pre
				</Button>

				<Button
					type="button"
					variant={viewMode === "post" ? "default" : "outline"}
					onClick={() => setViewMode("post")}
				>
					Show Post
				</Button>

				<Button
					type="button"
					variant={viewMode === "slider" ? "default" : "outline"}
					onClick={() => setViewMode("slider")}
				>
					Slider
				</Button>
			</div>

			{/* Slider Container */}
			<div
				ref={containerRef}
				className="relative h-64 w-full max-w-3xl select-none overflow-hidden rounded-xl border border-border bg-card shadow-lg"
			>
				{/* Pre image */}
				<img
					src={preURL}
					alt="Pre disaster"
					className="absolute left-0 top-0 h-full w-full object-cover"
					style={{ opacity: viewMode === "post" ? 0 : 1 }}
				/>

				{/* Post image */}
				<img
					src={postURL}
					alt="Post disaster"
					className="absolute left-0 top-0 h-full w-full object-cover pointer-events-none transition-opacity duration-300"
					style={{
						opacity: viewMode === "pre" ? 0 : 1,
						clipPath:
							viewMode === "slider"
								? `inset(0 ${clipPercentage}% 0 0)`
								: "inset(0 0 0 0)",
					}}
				/>

				{/* Slider handle */}
				{viewMode === "slider" && (
					<div
						ref={handleRef}
						className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-ew-resize border border-gray-400 bg-white"
						style={{ left: sliderX }}
					/>
				)}
			</div>
		</div>
	);
}
