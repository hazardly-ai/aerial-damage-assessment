"use client";

import { useEffect, useState } from "react";
import DisasterResponseAssistant from "@/components/features/DisasterResponseAssistant";
import Container from "@/components/layout/Container";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { evaluateVlm, type VlmEvaluationResult } from "@/utils/hazardlyApi";

const DAMAGE_COLORS: Record<string, string> = {
	"no-damage": "bg-green-100 text-green-800 border-green-300",
	"minor-damage": "bg-yellow-100 text-yellow-800 border-yellow-300",
	"major-damage": "bg-orange-100 text-orange-800 border-orange-300",
	destroyed: "bg-red-100 text-red-800 border-red-300",
};

function DamageLabel({ damageClass }: { damageClass: string }) {
	const color =
		DAMAGE_COLORS[damageClass] ?? "bg-gray-100 text-gray-800 border-gray-300";

	return (
		<span
			className={`inline-block rounded-full border px-3 py-1 text-sm font-semibold ${color}`}
		>
			{damageClass}
		</span>
	);
}

function ProbabilityBar({ label, value }: { label: string; value: number }) {
	const pct = Math.round(value * 100);

	return (
		<div className="flex items-center gap-3">
			<span className="w-28 truncate text-sm text-muted-foreground">
				{label}
			</span>

			<div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-all"
					style={{ width: `${pct}%` }}
				/>
			</div>

			<span className="w-12 text-right font-mono text-sm">{pct}%</span>
		</div>
	);
}

function ResultsPanel({ result }: { result: VlmEvaluationResult }) {
	const { prediction, model_version, is_mock } = result;

	return (
		<div className="space-y-5 rounded-xl border border-border/40 bg-card p-6 shadow-sm">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-lg font-bold">Damage Assessment</h3>

				<div className="flex items-center gap-2">
					{is_mock && (
						<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
							Mock Data
						</span>
					)}

					<span className="text-xs text-muted-foreground">{model_version}</span>
				</div>
			</div>

			<div className="flex items-center gap-4">
				<DamageLabel damageClass={prediction.damage_class} />

				<span className="text-sm text-muted-foreground">
					{Math.round(prediction.confidence * 100)}% confidence
				</span>
			</div>

			<p className="text-sm leading-relaxed">{prediction.description}</p>

			<div className="space-y-2">
				<p className="text-sm font-semibold">Class Probabilities</p>

				<ProbabilityBar
					label="No Damage"
					value={prediction.probabilities.no_damage}
				/>

				<ProbabilityBar
					label="Minor"
					value={prediction.probabilities.minor_damage}
				/>

				<ProbabilityBar
					label="Major"
					value={prediction.probabilities.major_damage}
				/>

				<ProbabilityBar
					label="Destroyed"
					value={prediction.probabilities.destroyed}
				/>
			</div>
		</div>
	);
}

export default function VlmEvaluationPage() {
	const [preImage, setPreImage] = useState<File | null>(null);
	const [postImage, setPostImage] = useState<File | null>(null);

	const [prePreview, setPrePreview] = useState<string | null>(null);
	const [postPreview, setPostPreview] = useState<string | null>(null);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [result, setResult] = useState<VlmEvaluationResult | null>(null);

	const [dragging, setDragging] = useState<"pre" | "post" | null>(null);

	useEffect(() => {
		return () => {
			if (prePreview) {
				URL.revokeObjectURL(prePreview);
			}

			if (postPreview) {
				URL.revokeObjectURL(postPreview);
			}
		};
	}, [prePreview, postPreview]);

	const validateImage = (file: File) =>
		["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type);

	const handleUpload = (file: File, type: "pre" | "post") => {
		setError(null);
		setResult(null);

		if (!validateImage(file)) {
			setError("Invalid image format. Please upload PNG, JPEG, or WebP.");

			return;
		}

		const url = URL.createObjectURL(file);

		if (type === "pre") {
			if (prePreview) {
				URL.revokeObjectURL(prePreview);
			}

			setPreImage(file);
			setPrePreview(url);

			return;
		}

		if (postPreview) {
			URL.revokeObjectURL(postPreview);
		}

		setPostImage(file);
		setPostPreview(url);
	};

	const handleDrop = (
		e: React.DragEvent<HTMLButtonElement>,
		type: "pre" | "post",
	) => {
		e.preventDefault();
		e.stopPropagation();

		setDragging(null);

		const droppedFile = e.dataTransfer.files?.[0];

		if (droppedFile) {
			handleUpload(droppedFile, type);
		}
	};

	const clearImage = (type: "pre" | "post") => {
		setError(null);
		setResult(null);

		if (type === "pre") {
			if (prePreview) {
				URL.revokeObjectURL(prePreview);
			}

			setPreImage(null);
			setPrePreview(null);

			return;
		}

		if (postPreview) {
			URL.revokeObjectURL(postPreview);
		}

		setPostImage(null);
		setPostPreview(null);
	};

	const handleEvaluate = async () => {
		if (!preImage || !postImage) {
			setError("Please upload both images.");

			return;
		}

		setLoading(true);
		setError(null);
		setResult(null);

		try {
			const data = await evaluateVlm(preImage, postImage);

			setResult(data);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Evaluation failed. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	};

	const renderUploadRow = (file: File | null, type: "pre" | "post") => (
		<div className="flex items-center justify-between gap-4">
			<label className="inline-block">
				<input
					type="file"
					accept="image/png,image/jpeg,image/webp"
					className="hidden"
					onChange={(e) => {
						const nextFile = e.target.files?.[0];

						if (nextFile) {
							handleUpload(nextFile, type);
						}
					}}
				/>

				<span className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80">
					Upload Image
				</span>
			</label>

			<div className="flex min-w-0 items-center gap-3">
				<p className="max-w-[340px] truncate text-xs text-muted-foreground">
					{file ? file.name : "No file selected"}
				</p>

				{file && (
					<button
						type="button"
						onClick={() => clearImage(type)}
						className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
					>
						Clear
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="flex min-h-screen flex-col">
			<Header />

			<main className="flex-1">
				<Container className="space-y-8 py-8">
					<div>
						<h2 className="text-2xl font-bold tracking-tight">
							VLM Damage Evaluation
						</h2>

						<p className="text-sm text-muted-foreground">
							Upload pre and post disaster building crops for AI damage
							assessment
						</p>
					</div>

					<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<div className="space-y-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
							<p className="font-semibold">Pre-Disaster Image</p>

							{renderUploadRow(preImage, "pre")}

							<button
								type="button"
								onDragOver={(e) => {
									e.preventDefault();
									setDragging("pre");
								}}
								onDragLeave={() => setDragging(null)}
								onDrop={(e) => handleDrop(e, "pre")}
								className={`relative flex h-52 w-full items-center justify-center rounded-lg border-2 border-dashed transition ${
									dragging === "pre"
										? "border-primary bg-primary/10"
										: "border-border bg-muted"
								}`}
							>
								{prePreview ? (
									<img
										src={prePreview}
										alt="Pre-disaster preview"
										className="h-full w-full rounded-lg object-contain"
									/>
								) : (
									<div className="text-center text-sm text-muted-foreground">
										<p>Drag & drop image here</p>

										<p className="mt-1 text-xs">or use Upload Image</p>
									</div>
								)}
							</button>
						</div>

						<div className="space-y-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
							<p className="font-semibold">Post-Disaster Image</p>

							{renderUploadRow(postImage, "post")}

							<button
								type="button"
								onDragOver={(e) => {
									e.preventDefault();
									setDragging("post");
								}}
								onDragLeave={() => setDragging(null)}
								onDrop={(e) => handleDrop(e, "post")}
								className={`relative flex h-52 w-full items-center justify-center rounded-lg border-2 border-dashed transition ${
									dragging === "post"
										? "border-primary bg-primary/10"
										: "border-border bg-muted"
								}`}
							>
								{postPreview ? (
									<img
										src={postPreview}
										alt="Post-disaster preview"
										className="h-full w-full rounded-lg object-contain"
									/>
								) : (
									<div className="text-center text-sm text-muted-foreground">
										<p>Drag & drop image here</p>

										<p className="mt-1 text-xs">or use Upload Image</p>
									</div>
								)}
							</button>
						</div>
					</div>

					<div className="flex justify-center">
						<button
							type="button"
							onClick={handleEvaluate}
							disabled={!preImage || !postImage || loading}
							className="rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-50"
						>
							{loading ? "Evaluating..." : "Run Evaluation"}
						</button>
					</div>

					{error && (
						<p className="text-center font-medium text-red-500">{error}</p>
					)}

					{loading && (
						<p className="text-center text-muted-foreground">
							Processing images...
						</p>
					)}

					{result && <ResultsPanel result={result} />}
				</Container>
			</main>

			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
