import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchImagePairXbdIds } from "@/utils/hazardlyApi";

type XbdSelectorStatus = "loading" | "ready" | "error";

interface UseXbdSelectorStateArgs {
	disasterId: number;
	selectedXbdId: number;
	onChange: (xbdId: number) => void;
	allowFallbackSelection?: boolean;
}

interface XbdSelectorProps {
	selectedXbdId: number;
	onChange: (xbdId: number) => void;
	disabled?: boolean;
	status: XbdSelectorStatus;
	xbdIds: number[];
	canGoPrev: boolean;
	canGoNext: boolean;
	onPrev: () => void;
	onNext: () => void;
	showArrows?: boolean;
}

export function useXbdSelectorState({
	disasterId,
	selectedXbdId,
	onChange,
	allowFallbackSelection = false,
}: UseXbdSelectorStateArgs) {
	const [xbdIds, setXbdIds] = useState<number[]>([]);
	const [status, setStatus] = useState<XbdSelectorStatus>("loading");
	const selectedXbdIdRef = useRef(selectedXbdId);
	selectedXbdIdRef.current = selectedXbdId;

	useEffect(() => {
		setStatus("loading");

		fetchImagePairXbdIds(disasterId)
			.then((res) => {
				const ids = res.xbd_ids;

				setXbdIds(ids);
				setStatus("ready");

				if (
					allowFallbackSelection &&
					ids.length > 0 &&
					!ids.includes(selectedXbdIdRef.current)
				) {
					onChange(ids[0]);
				}
			})
			.catch(() => setStatus("error"));
	}, [allowFallbackSelection, disasterId, onChange]);

	const currentIndex = xbdIds.indexOf(selectedXbdId);
	const canGoPrev = currentIndex > 0;
	const canGoNext = currentIndex >= 0 && currentIndex < xbdIds.length - 1;

	return useMemo(
		() => ({
			xbdIds,
			status,
			canGoPrev,
			canGoNext,
			goPrev: () => {
				if (canGoPrev) onChange(xbdIds[currentIndex - 1]);
			},
			goNext: () => {
				if (canGoNext) onChange(xbdIds[currentIndex + 1]);
			},
		}),
		[xbdIds, status, canGoPrev, canGoNext, onChange, currentIndex],
	);
}

export function XbdSelector({
	selectedXbdId,
	onChange,
	disabled,
	status,
	xbdIds,
	canGoPrev,
	canGoNext,
	onPrev,
	onNext,
	showArrows = true,
}: XbdSelectorProps) {
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
			{showArrows && (
				<button
					type="button"
					className="xbd-selector__arrow"
					onClick={onPrev}
					disabled={isDisabled || !canGoPrev}
					aria-label="Previous scene"
				>
					<ChevronLeft size={16} />
				</button>
			)}
			<div className="xbd-selector__select-wrapper">
				<select
					className="xbd-selector__select"
					value={selectedXbdId}
					disabled={isDisabled}
					onChange={(e) => onChange(Number(e.target.value))}
				>
					{status === "loading" ? (
						<option>Loading...</option>
					) : (
						xbdIds.map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))
					)}
				</select>
			</div>
			{showArrows && (
				<button
					type="button"
					className="xbd-selector__arrow"
					onClick={onNext}
					disabled={isDisabled || !canGoNext}
					aria-label="Next scene"
				>
					<ChevronRight size={16} />
				</button>
			)}
		</div>
	);
}
