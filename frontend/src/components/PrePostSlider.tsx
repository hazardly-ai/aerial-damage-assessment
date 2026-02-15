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

	// Preload images and only display after both loaded
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
		preImg.onload = onLoad;

		postImg.src = postObj;
		postImg.onload = onLoad;

		setPreURL(preObj);
		setPostURL(postObj);

		return () => {
			URL.revokeObjectURL(preObj);
			URL.revokeObjectURL(postObj);
		};
	}, [preImage, postImage]);

	// Initialize slider in middle
	useEffect(() => {
		if (containerRef.current) setSliderX(containerRef.current.offsetWidth / 2);
	}, [preURL, postURL, loaded]);

	// Drag logic
	useEffect(() => {
		if (!handleRef.current || !containerRef.current) return;

		const handle = handleRef.current;
		const container = containerRef.current;
		let isDragging = false;

		const onMouseDown = () => (isDragging = true);
		const onMouseUp = () => (isDragging = false);
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
			if (containerRef.current)
				setSliderX(containerRef.current.offsetWidth / 2);
		};
		window.addEventListener("resize", handleResize);

		return () => {
			handle.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("resize", handleResize);
		};
	}, [preURL, postURL]);

	if (!preImage || !postImage || !loaded) {
		return (
			<div className="flex h-64 w-full max-w-3xl items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
				Upload both Pre and Post images to view
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-4 w-full">
			{/* Toggle Buttons */}
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

			{/* Slider Container */}
			<div
				ref={containerRef}
				className="relative w-full max-w-3xl h-64 overflow-hidden rounded-xl border border-border shadow-lg bg-card select-none"
			>
				{/* Pre image */}
				<img
					src={preURL!}
					alt="Pre"
					className="absolute top-0 left-0 w-full h-full object-cover"
					style={{ opacity: viewMode === "post" ? 0 : 1 }}
				/>

				{/* Post image */}
				<img
					src={postURL!}
					alt="Post"
					className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300"
					style={{
						opacity: viewMode === "pre" ? 0 : 1,
						clipPath:
							viewMode === "slider"
								? `inset(0 ${100 - (sliderX / containerRef.current!.offsetWidth) * 100}% 0 0)`
								: "inset(0 0 0 0)",
					}}
				/>

				{/* Slider handle */}
				{viewMode === "slider" && (
					<div
						ref={handleRef}
						className="absolute top-0 -translate-x-1/2 w-2 h-full bg-white border border-gray-400 cursor-ew-resize"
						style={{ left: sliderX }}
					/>
				)}
			</div>
		</div>
	);
}
