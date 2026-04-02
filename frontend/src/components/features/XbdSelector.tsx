import { useEffect, useState } from "react";
import { fetchImagePairs } from "@/utils/hazardlyApi";

interface XbdSelectorProps {
	disasterId: number;
	selectedXbdId: number;
	onChange: (xbdId: number) => void;
	disabled?: boolean;
}

export function XbdSelector({
	disasterId,
	selectedXbdId,
	onChange,
	disabled,
}: XbdSelectorProps) {
	const [xbdIds, setXbdIds] = useState<number[]>([]);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);

	useEffect(() => {
		setStatus("loading");

		fetchImagePairs(disasterId)
			.then((res) => {
				const ids = res.features
					.map((f) => f.properties.xbd_id)
					.filter((id): id is number => typeof id === "number")
					.sort((a, b) => a - b);

				setXbdIds(ids);
				setStatus("ready");

				// ensure selected ID is valid
				if (ids.length > 0 && !ids.includes(selectedXbdId)) {
					onChange(ids[0]);
				}
			})
			.catch(() => setStatus("error"));
	}, [disasterId, selectedXbdId, onChange]);

	// Handle no data
	if (status === "ready" && xbdIds.length === 0) {
		return (
			<span className="xbd-selector" role="alert">
				No scenes available
			</span>
		);
	}

	if (status === "error") {
		return (
			<span className="xbd-selector xbd-selector--error" role="alert">
				Failed to load scenes
			</span>
		);
	}

	return (
		<label className="xbd-selector">
			<span className="xbd-selector__label">Scene</span>
			<select
				className="xbd-selector__select"
				value={selectedXbdId}
				disabled={disabled || status === "loading"}
				onChange={(e) => onChange(Number(e.target.value))}
			>
				{status === "loading" ? (
					<option>Loading…</option>
				) : (
					xbdIds.map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))
				)}
			</select>
		</label>
	);
}
