interface BuildingPopupProps {
	uid?: string | number;
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
					<div className="popup-value">
						{uid != null && String(uid) !== "" ? String(uid) : "—"}
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
			<div className="popup-card popup-arrow" />
		</div>
	);
}
