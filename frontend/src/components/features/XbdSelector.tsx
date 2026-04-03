import { ChevronLeft, ChevronRight } from "lucide-react";
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
					.filter((id): id is number => true)
					.sort((a, b) => a - b);

				setXbdIds(ids);
				setStatus("ready");

				if (ids.length > 0 && !ids.includes(selectedXbdId)) {
					onChange(ids[0]);
				}
			})
			.catch(() => setStatus("error"));
	}, [disasterId, selectedXbdId, onChange]);

	const currentIndex = xbdIds.indexOf(selectedXbdId);
	const canGoPrev = currentIndex > 0;
	const canGoNext = currentIndex < xbdIds.length - 1;

	const goPrev = () => {
		if (canGoPrev) onChange(xbdIds[currentIndex - 1]);
	};
	const goNext = () => {
		if (canGoNext) onChange(xbdIds[currentIndex + 1]);
	};

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

	const isDisabled = disabled || status === "loading";

	return (
		<div className="xbd-selector">
			<span className="xbd-selector__label">Scene</span>
			<button
				type="button"
				className="xbd-selector__arrow"
				onClick={goPrev}
				disabled={isDisabled || !canGoPrev}
				aria-label="Previous scene"
			>
				<ChevronLeft size={16} />
			</button>
			<div className="xbd-selector__select-wrapper">
				<select
					className="xbd-selector__select"
					value={selectedXbdId}
					disabled={isDisabled}
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
			</div>
			<button
				type="button"
				className="xbd-selector__arrow"
				onClick={goNext}
				disabled={isDisabled || !canGoNext}
				aria-label="Next scene"
			>
				<ChevronRight size={16} />
			</button>
		</div>
	);
}
