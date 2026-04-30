"use client";

import { useState } from "react";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant";
import Container from "@/components/layout/Container";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";

/* type Result = {
	label: string;
	confidence?: number;
};
*/

export default function VlmEvaluationPage() {
	const [preImage, setPreImage] = useState<File | null>(null);
	const [postImage, setPostImage] = useState<File | null>(null);

	const [prePreview, setPrePreview] = useState<string | null>(null);
	const [postPreview, setPostPreview] = useState<string | null>(null);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const validateImage = (file: File) =>
		["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type);

	const handleUpload = (file: File, type: "pre" | "post") => {
		setError(null);

		if (!validateImage(file)) {
			setError("Invalid image format.");
			return;
		}

		const url = URL.createObjectURL(file);

		if (type === "pre") {
			setPreImage(file);
			setPrePreview(url);
		} else {
			setPostImage(file);
			setPostPreview(url);
		}
	};

	const handleEvaluate = async () => {
		if (!preImage || !postImage) {
			setError("Please upload both images.");
			return;
		}

		setLoading(true);
		setError(null);

		const formData = new FormData();
		formData.append("pre_image", preImage);
		formData.append("post_image", postImage);

		try {
			const res = await fetch("/api/vlm/evaluate", {
				method: "POST",
				body: formData,
			});

			if (!res.ok) throw new Error("Evaluation failed");

			const data = await res.json();

			console.log("Result:", data);
		} catch {
			setError("Evaluation failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen flex flex-col">
			<Header />

			<main className="flex-1">
				<Container className="py-8 space-y-8">
					<div>
						<h2 className="text-2xl font-bold tracking-tight">
							VLM Damage Evaluation
						</h2>
						<p className="text-sm text-muted-foreground">
							Upload pre/post disaster images for AI assessment
						</p>
					</div>

					{/* UPLOAD GRID */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* PRE */}
						<div className="rounded-xl p-4 bg-card space-y-3 border border-border/40 shadow-sm">
							<p className="font-semibold">Pre-Disaster Image</p>

							<label className="inline-block">
								<input
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) =>
										e.target.files && handleUpload(e.target.files[0], "pre")
									}
								/>
								<span className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium cursor-pointer hover:bg-secondary/80 transition">
									Upload Image
								</span>
							</label>

							{prePreview ? (
								<img
									src={prePreview}
									alt="Pre-disaster preview"
									className="h-52 w-full object-cover rounded-lg border"
								/>
							) : (
								<div className="h-52 flex items-center justify-center bg-muted text-muted-foreground rounded-lg">
									No image selected
								</div>
							)}
						</div>

						{/* POST */}
						<div className="rounded-xl p-4 bg-card space-y-3 border border-border/40 shadow-sm">
							<p className="font-semibold">Post-Disaster Image</p>

							<label className="inline-block">
								<input
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) =>
										e.target.files && handleUpload(e.target.files[0], "post")
									}
								/>
								<span className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium cursor-pointer hover:bg-secondary/80 transition">
									Upload Image
								</span>
							</label>

							{postPreview ? (
								<img
									src={postPreview}
									alt="Post-disaster preview"
									className="h-52 w-full object-cover rounded-lg border"
								/>
							) : (
								<div className="h-52 flex items-center justify-center bg-muted text-muted-foreground rounded-lg">
									No image selected
								</div>
							)}
						</div>
					</div>

					{/* BUTTON */}
					<div className="flex justify-center">
						<button
							type="button"
							onClick={handleEvaluate}
							disabled={!preImage || !postImage || loading}
							className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
						>
							{loading ? "Evaluating..." : "Run Evaluation"}
						</button>
					</div>

					{/* ERROR */}
					{error && (
						<p className="text-center text-red-500 font-medium">{error}</p>
					)}

					{/* LOADING */}
					{loading && (
						<p className="text-center text-muted-foreground">
							Processing images...
						</p>
					)}
				</Container>
			</main>

			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
