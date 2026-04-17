import React from "react";

interface BuildingPopupProps {
	uid: string;
	address?: string;
	predictedDamage?: string;
	predictedDamageColor: string;
	actualDamage?: string;
	actualDamageColor: string;
	onClose: () => void;
}

export function BuildingPopup({
	uid,
	address,
	predictedDamage,
	predictedDamageColor,
	actualDamage,
	actualDamageColor,
	onClose,
}: BuildingPopupProps) {
	const [copied, setCopied] = React.useState(false);
	const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		return () => {
			if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
		};
	}, []);

	const copyText = address || uid;

	const handleCopy = React.useCallback(async () => {
		try {
			await navigator.clipboard.writeText(copyText);
			setCopied(true);
			if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
			copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy to clipboard:", err);
		}
	}, [copyText]);

	return (
		<div className="popup-card">
			<div className="popup-header">
				<span>🏠 Building Damage Report</span>
				<button
					className="popup-close-btn"
					onClick={onClose}
					aria-label="Close popup"
					type="button"
				>
					×
				</button>
			</div>
			<div className="popup-body">
				<div className="popup-section">
					<div className="popup-label">Address</div>
					<div className="popup-value-container">
						<span className="popup-value">{address || "—"}</span>
						{address && (
							<button
								className="copy-btn"
								onClick={handleCopy}
								aria-label="Copy address"
								type="button"
							>
								<svg
									className={`copy-icon ${copied ? "copied" : ""}`}
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<title>{copied ? "Copied" : "Copy to clipboard"}</title>
									{copied ? (
										<polyline points="20 6 9 17 4 12" />
									) : (
										<>
											<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
											<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
										</>
									)}
								</svg>
							</button>
						)}
					</div>
					{uid.length > 0 && (
						<div className="popup-uid-subfield">{uid}</div>
					)}
				</div>
				<div className="popup-section">
					<div className="popup-label">Predicted Damage</div>
					<span
						className="popup-damage"
						style={{ backgroundColor: predictedDamageColor }}
					>
						{predictedDamage != null && String(predictedDamage) !== ""
							? String(predictedDamage)
							: "—"}
					</span>
				</div>
				<div className="popup-section">
					<div className="popup-label">Actual Damage</div>
					<span
						className="popup-damage"
						style={{ backgroundColor: actualDamageColor }}
					>
						{actualDamage != null && String(actualDamage) !== ""
							? String(actualDamage)
							: "—"}
					</span>
				</div>
			</div>
			<div className="popup-arrow" />
		</div>
	);
}
