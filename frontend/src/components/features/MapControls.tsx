import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	useXbdSelectorState,
	XbdSelector,
} from "@/components/features/XbdSelector";

interface MapControlsProps {
	disasterId: number;
	selectedXbdId: number;
	onXbdChange: (xbdId: number) => void;
	sceneDisabled: boolean;
	sceneLoading: boolean;
	imageryVisible: boolean;
	onImageryToggle: () => void;
	buildingsVisible: boolean;
	onBuildingsToggle: () => void;
	visible: boolean;
}

interface LayerToggleRowProps {
	label: string;
	active: boolean;
	onClick: () => void;
	title: string;
}

function LayerToggleRow({
	label,
	active,
	onClick,
	title,
}: LayerToggleRowProps) {
	return (
		<button
			type="button"
			className="map-layer-toggle"
			data-active={active ? "true" : "false"}
			onClick={onClick}
			title={title}
		>
			<span className="map-layer-toggle__label">{label}</span>
			<span className="building-toggle-track" aria-hidden="true">
				<span className="building-toggle-knob" />
			</span>
		</button>
	);
}

export function MapControls({
	disasterId,
	selectedXbdId,
	onXbdChange,
	sceneDisabled,
	sceneLoading,
	imageryVisible,
	onImageryToggle,
	buildingsVisible,
	onBuildingsToggle,
	visible,
}: MapControlsProps) {
	const [collapsed, setCollapsed] = useState(true);
	const xbdSelector = useXbdSelectorState({
		disasterId,
		selectedXbdId,
		onChange: onXbdChange,
	});
	const headerNavDisabled = sceneDisabled || xbdSelector.status !== "ready";

	return (
		<div
			className="map-controls"
			data-collapsed={collapsed ? "true" : "false"}
			style={{ visibility: visible ? "visible" : "hidden" }}
		>
			<div className="map-controls__header">
				<button
					type="button"
					className="map-controls__toggle-copy map-controls__toggle-copy--button"
					onClick={() => setCollapsed((current) => !current)}
					aria-expanded={collapsed ? "false" : "true"}
					aria-label={collapsed ? "Expand controls" : "Collapse controls"}
				>
					<span className="map-controls__toggle-title">Controls</span>
					<span className="map-controls__toggle-summary">
						XBD {selectedXbdId}
					</span>
				</button>
				{collapsed && (
					<span className="map-controls__header-nav">
						<button
							type="button"
							className="xbd-selector__arrow map-controls__header-arrow"
							onClick={(e) => {
								e.stopPropagation();
								xbdSelector.goPrev();
							}}
							disabled={headerNavDisabled || !xbdSelector.canGoPrev}
							aria-label="Previous scene"
						>
							<ChevronLeft size={14} />
						</button>
						<button
							type="button"
							className="xbd-selector__arrow map-controls__header-arrow"
							onClick={(e) => {
								e.stopPropagation();
								xbdSelector.goNext();
							}}
							disabled={headerNavDisabled || !xbdSelector.canGoNext}
							aria-label="Next scene"
						>
							<ChevronRight size={14} />
						</button>
					</span>
				)}
				<button
					type="button"
					className="map-controls__toggle"
					onClick={() => setCollapsed((current) => !current)}
					aria-expanded={collapsed ? "false" : "true"}
					aria-label={collapsed ? "Expand controls" : "Collapse controls"}
				>
					<span
						className="map-controls__toggle-icon select-none"
						aria-hidden="true"
					>
						{collapsed ? "+" : "-"}
					</span>
				</button>
			</div>

			<div
				className="map-controls__body"
				aria-hidden={collapsed ? "true" : "false"}
			>
				<div className="map-controls__section">
					<div className="map-controls__section-header">
						<p className="map-controls__section-title">Scene</p>
						{sceneLoading && (
							<span className="map-controls__status" aria-live="polite">
								Switching...
							</span>
						)}
					</div>
					<XbdSelector
						selectedXbdId={selectedXbdId}
						onChange={onXbdChange}
						status={xbdSelector.status}
						xbdIds={xbdSelector.xbdIds}
						canGoPrev={xbdSelector.canGoPrev}
						canGoNext={xbdSelector.canGoNext}
						onPrev={xbdSelector.goPrev}
						onNext={xbdSelector.goNext}
						disabled={sceneDisabled || collapsed}
						showArrows={!collapsed}
					/>
				</div>

				<div className="map-controls__divider" />

				<div className="map-controls__section">
					<p className="map-controls__section-title">Layers</p>
					<div className="map-controls__layers">
						<LayerToggleRow
							label="Imagery"
							active={imageryVisible}
							onClick={onImageryToggle}
							title={
								imageryVisible ? "Hide imagery layer" : "Show imagery layer"
							}
						/>
						<LayerToggleRow
							label="Building Polygons"
							active={buildingsVisible}
							onClick={onBuildingsToggle}
							title={
								buildingsVisible
									? "Hide building polygons"
									: "Show building polygons"
							}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
