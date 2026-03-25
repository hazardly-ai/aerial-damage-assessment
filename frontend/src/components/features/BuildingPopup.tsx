import React from "react";

interface BuildingPopupProps {
	uid: string;
	damage?: string;
	damageColor: string;
	onClose: () => void;
}

export function BuildingPopup({
	uid,
	damage,
	damageColor,
	onClose,
}: BuildingPopupProps) {
	const [copied, setCopied] = React.useState(false);

	const handleCopyUID = () => {
		navigator.clipboard.writeText(uid);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

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
					<div className="popup-label">Building ID</div>
					<div className="popup-value-container">
						<span className="popup-value">{uid.length > 0 ? uid : "—"}</span>
						{uid.length > 0 && (
							<button
								className="copy-btn"
								onClick={handleCopyUID}
								aria-label="Copy building ID"
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
				</div>
				<div className="popup-section">
					<div className="popup-label">Predicted Damage</div>
					<span
						className="popup-damage"
						style={{ backgroundColor: damageColor }}
					>
						{damage != null && String(damage) !== "" ? String(damage) : "—"}
					</span>
				</div>
			</div>
			<div className="popup-arrow" />
		</div>
	);
}
