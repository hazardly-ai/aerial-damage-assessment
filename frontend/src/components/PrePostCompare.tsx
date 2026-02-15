import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export default function PrePostCompare() {
	const [preImage, setPreImage] = useState<File | null>(null);
	const [postImage, setPostImage] = useState<File | null>(null);
	const [showPre, setShowPre] = useState(true);
	const sliderRef = useRef<HTMLDivElement | null>(null);
	const handleRef = useRef<HTMLDivElement | null>(null);
	const [sliderWidth, setSliderWidth] = useState(0);

	// Update slider width on mount or resize
	useEffect(() => {
		const updateWidth = () => {
			if (sliderRef.current) setSliderWidth(sliderRef.current.offsetWidth / 2);
		};
		updateWidth();
		window.addEventListener("resize", updateWidth);
		return () => window.removeEventListener("resize", updateWidth);
	}, []);

	// Drag logic
	useEffect(() => {
		if (!handleRef.current || !sliderRef.current) return;

		const handle = handleRef.current;
		const container = sliderRef.current;

		let isDragging = false;

		const onMouseDown = () => (isDragging = true);
		const onMouseUp = () => (isDragging = false);
		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			const rect = container.getBoundingClientRect();
			let newWidth = e.clientX - rect.left;
			if (newWidth < 0) newWidth = 0;
			if (newWidth > rect.width) newWidth = rect.width;
			setSliderWidth(newWidth);
		};

		handle.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("mousemove", onMouseMove);

		return () => {
			handle.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("mousemove", onMouseMove);
		};
	}, []);

	return (
		<div className="flex flex-col items-center gap-6">
			{/* Upload Controls */}
			<div className="flex flex-wrap gap-4">
				<div>
					<label className="block text-sm font-medium text-muted-foreground">
						Pre-disaster Image
					</label>
					<input
						type="file"
						accept="image/*"
						onChange={(e) =>
							e.target.files ? setPreImage(e.target.files[0]) : null
						}
						className="mt-1"
					/>
				</div>

				<div>
					<label className="block text-sm font-medium text-muted-foreground">
						Post-disaster Image
					</label>
					<input
						type="file"
						accept="image/*"
						onChange={(e) =>
							e.target.files ? setPostImage(e.target.files[0]) : null
						}
						className="mt-1"
					/>
				</div>
			</div>

			{/* Toggle Buttons */}
			<div className="flex gap-3">
				<Button
					variant={showPre ? "default" : "outline"}
					onClick={() => setShowPre(true)}
				>
					Show Pre
				</Button>
				<Button
					variant={!showPre ? "default" : "outline"}
					onClick={() => setShowPre(false)}
				>
					Show Post
				</Button>
			</div>

			{/* Image Display */}
			<div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-border shadow-lg">
				{preImage && postImage ? (
					<>
						{/* Pre Image */}
						<img
							src={URL.createObjectURL(preImage)}
							alt="Pre-disaster"
							className={`absolute top-0 left-0 w-full h-auto object-contain transition-opacity duration-300 ${
								showPre ? "opacity-100" : "opacity-0"
							}`}
						/>
						{/* Post Image */}
						<img
							src={URL.createObjectURL(postImage)}
							alt="Post-disaster"
							className={`absolute top-0 left-0 w-full h-auto object-contain transition-opacity duration-300 ${
								showPre ? "opacity-0" : "opacity-100"
							}`}
						/>

						{/* Slider Comparison */}
						<div
							ref={sliderRef}
							className="relative w-full h-auto select-none cursor-ew-resize"
							style={{ maxHeight: "500px" }}
						>
							{/* Pre image cropped to slider width */}
							<div
								style={{
									width: sliderWidth,
									overflow: "hidden",
									position: "absolute",
									top: 0,
									left: 0,
								}}
							>
								<img
									src={URL.createObjectURL(preImage)}
									alt="Pre-slide"
									className="w-full h-auto object-contain pointer-events-none"
								/>
							</div>

							{/* Draggable Handle */}
							<div
								ref={handleRef}
								className="absolute top-0 -translate-x-1/2 bg-white border border-gray-400 w-2 h-full cursor-ew-resize"
								style={{ left: sliderWidth }}
							/>
						</div>
					</>
				) : (
					<div className="flex h-64 w-full items-center justify-center text-muted-foreground">
						Upload both Pre and Post images to view
					</div>
				)}
			</div>
		</div>
	);
}
