"use client";

import { useState } from "react";
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
			className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${color}`}
		>
			{damageClass}
		</span>
	);
}

function ProbabilityBar({ label, value }: { label: string; value: number }) {
	const pct = Math.round(value * 100);
	return (
		<div className="flex items-center gap-3">
			<span className="w-28 text-sm text-muted-foreground truncate">
				{label}
			</span>
			<div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
				<div
					className="h-full bg-primary rounded-full transition-all"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="w-12 text-sm text-right font-mono">{pct}%</span>
		</div>
	);
}

function ResultsPanel({ result }: { result: VlmEvaluationResult }) {
	const { prediction, model_version, is_mock } = result;
	return (
		<div className="border rounded-xl p-6 bg-card space-y-5">
			<div className="flex items-center justify-between">
				<h3 className="text-lg font-bold">Damage Assessment</h3>
				<div className="flex items-center gap-2">
					{is_mock && (
						<span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
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
							Upload pre and post disaster building crops for AI damage
							assessment
						</p>
					</div>

					{/* UPLOAD GRID */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* PRE */}
						<div className="border rounded-xl p-4 bg-card space-y-3">
							<p className="font-semibold">Pre-Disaster Image</p>

							<input
								type="file"
								accept="image/png,image/jpeg,image/webp"
								onChange={(e) =>
									e.target.files?.[0] && handleUpload(e.target.files[0], "pre")
								}
							/>

							{prePreview ? (
								<img
									src={prePreview}
									alt="Pre-disaster preview"
									className="h-64 w-full object-contain rounded-lg border bg-muted"
								/>
							) : (
								<div className="h-52 flex items-center justify-center bg-muted text-muted-foreground rounded-lg">
									No image selected
								</div>
							)}
						</div>

						{/* POST */}
						<div className="border rounded-xl p-4 bg-card space-y-3">
							<p className="font-semibold">Post-Disaster Image</p>

							<input
								type="file"
								accept="image/png,image/jpeg,image/webp"
								onChange={(e) =>
									e.target.files?.[0] && handleUpload(e.target.files[0], "post")
								}
							/>

							{postPreview ? (
								<img
									src={postPreview}
									alt="Post-disaster preview"
									className="h-64 w-full object-contain rounded-lg border bg-muted"
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

					{/* RESULTS */}
					{result && <ResultsPanel result={result} />}
				</Container>
			</main>
			<DisasterResponseAssistant />
			<Footer />
		</div>
	);
}
