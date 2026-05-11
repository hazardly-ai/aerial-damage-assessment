import mapboxgl from "mapbox-gl";
import type Compare from "mapbox-gl-compare";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import "mapbox-gl-compare/dist/mapbox-gl-compare.css";

import { toast } from "sonner";
import { BuildingPopup } from "@/components/features/BuildingPopup";
import { MapControls } from "@/components/features/MapControls";
import { MapLoadingOverlay } from "@/components/features/MapLoadingOverlay";
import { useLoadingOverlay } from "@/hooks/useLoadingOverlay";
import type { ChatMapCommand } from "@/types/chat";
import type { MapStatus, SceneMetrics } from "@/types/map.ts";
import { BUILDINGS_SOURCE_ID } from "@/utils/addBuildingLayer";
import type { BuildingFeature, BuildingsResponse } from "@/utils/hazardlyApi";
import {
	fetchMapData,
	type ImageBounds,
	resolveImageUrl,
} from "@/utils/hazardlyApi";
import {
	addInitialSourcesAndLayers,
	bindBuildingInteractions,
	createCompareInstance,
	createMapInstance,
	POST_IMAGE_LAYER_ID,
	type PopupData,
	PRE_IMAGE_LAYER_ID,
	selectBuildingByUid,
	setBuildingVisibility,
	setHighlightedBuildingsByUid,
	setImageryVisibility,
	setSatelliteOpacity,
	waitForMapsLoad,
} from "@/utils/mapViewSetup";

interface MapViewProps {
	initialDisasterId: number;
	selectedXbdId: number;
	onXbdChange: (xbdId: number) => void;
	/** When set (e.g. from `?building=` on first load), selects that footprint and opens the popup. */
	initialBuildingUid?: string;
	onInitialBuildingHandled?: () => void;
	onSceneError?: (message: string) => void;
	onMetricsChange?: (metrics: SceneMetrics | null) => void;
	xbdSelectorStatus: "loading" | "ready" | "error";
	xbdIds: number[];
	canGoPrev: boolean;
	canGoNext: boolean;
	onPrev: () => void;
	onNext: () => void;
	chatCommand?: ChatMapCommand | null;
}

const CHAT_FOCUS_FALLBACK_ZOOM = 18;
const CHAT_FIT_PADDING = 72;

function extendBoundsWithGeometry(
	bounds: mapboxgl.LngLatBounds,
	geometry: GeoJSON.Geometry,
) {
	const extendCoordinates = (coordinates: number[][]) => {
		for (const coordinate of coordinates) {
			bounds.extend([coordinate[0], coordinate[1]]);
		}
	};

	if (geometry.type === "Polygon") {
		for (const ring of geometry.coordinates) {
			extendCoordinates(ring);
		}
		return;
	}

	if (geometry.type === "MultiPolygon") {
		for (const polygon of geometry.coordinates) {
			for (const ring of polygon) {
				extendCoordinates(ring);
			}
		}
	}
}

function computeSceneMetrics(
	xbdId: number,
	buildings: BuildingsResponse,
): SceneMetrics {
	const features = buildings.features;
	type DamageLevel =
		| "no-damage"
		| "minor-damage"
		| "major-damage"
		| "destroyed";
	type NormalizedDamage = DamageLevel | "un-classified";
	const DAMAGE_CLASSES = [
		"no-damage",
		"minor-damage",
		"major-damage",
		"destroyed",
	] as const;

	const predictedDistribution: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};
	const actualDistribution: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};
	const confusionMatrix: Record<string, Record<string, number>> = {
		"no-damage": {
			"no-damage": 0,
			"minor-damage": 0,
			"major-damage": 0,
			destroyed: 0,
		},
		"minor-damage": {
			"no-damage": 0,
			"minor-damage": 0,
			"major-damage": 0,
			destroyed: 0,
		},
		"major-damage": {
			"no-damage": 0,
			"minor-damage": 0,
			"major-damage": 0,
			destroyed: 0,
		},
		destroyed: {
			"no-damage": 0,
			"minor-damage": 0,
			"major-damage": 0,
			destroyed: 0,
		},
	};
	let evaluatedPredictions = 0;
	let correctPredictions = 0;

	const normalizeDamageLabel = (value: unknown): NormalizedDamage => {
		if (typeof value !== "string" || value.trim().length === 0) {
			return "un-classified";
		}
		const normalized = value
			.trim()
			.toLowerCase()
			.replace(/[_\s]+/g, "-")
			.replace(/-+/g, "-");

		if (normalized === "no-damage" || normalized === "no-damages") {
			return "no-damage";
		}
		if (normalized === "minor-damage" || normalized === "minor-damages") {
			return "minor-damage";
		}
		if (normalized === "major-damage" || normalized === "major-damages") {
			return "major-damage";
		}
		if (normalized === "destroyed" || normalized === "destroy") {
			return "destroyed";
		}
		if (
			normalized === "un-classified" ||
			normalized === "unclassified" ||
			normalized === "unknown" ||
			normalized === "uncertain"
		) {
			return "un-classified";
		}

		return "un-classified";
	};

	for (const feature of features) {
		const building = feature as BuildingFeature;
		const predictedDamageValue = normalizeDamageLabel(
			building.properties.predicted_damage,
		);
		const actualDamageValue = normalizeDamageLabel(
			building.properties.actual_damage,
		);

		if (
			predictedDamageValue !== "un-classified" &&
			DAMAGE_CLASSES.includes(predictedDamageValue)
		) {
			predictedDistribution[predictedDamageValue] += 1;
		}
		if (
			actualDamageValue !== "un-classified" &&
			DAMAGE_CLASSES.includes(actualDamageValue)
		) {
			actualDistribution[actualDamageValue] += 1;
		}

		if (
			predictedDamageValue !== "un-classified" &&
			actualDamageValue !== "un-classified"
		) {
			evaluatedPredictions += 1;
			if (predictedDamageValue === actualDamageValue) {
				correctPredictions += 1;
			}
			confusionMatrix[actualDamageValue][predictedDamageValue] += 1;
		}
	}

	let matrixMax = 0;
	for (const actualLabel of DAMAGE_CLASSES) {
		for (const predictedLabel of DAMAGE_CLASSES) {
			const value = confusionMatrix[actualLabel][predictedLabel];
			if (value > matrixMax) matrixMax = value;
		}
	}

	const perClassMetrics: Record<
		string,
		{
			precision: number | null;
			recall: number | null;
			f1: number | null;
		}
	> = {};
	let precisionSum = 0;
	let recallSum = 0;
	let f1Sum = 0;
	let precisionCount = 0;
	let recallCount = 0;
	let f1Count = 0;

	for (const label of DAMAGE_CLASSES) {
		const tp = confusionMatrix[label][label];
		let fp = 0;
		let fn = 0;
		for (const actualLabel of DAMAGE_CLASSES) {
			if (actualLabel !== label) {
				fp += confusionMatrix[actualLabel][label];
			}
		}
		for (const predictedLabel of DAMAGE_CLASSES) {
			if (predictedLabel !== label) {
				fn += confusionMatrix[label][predictedLabel];
			}
		}

		const precisionRatio = tp + fp > 0 ? tp / (tp + fp) : null;
		const recallRatio = tp + fn > 0 ? tp / (tp + fn) : null;
		const f1Ratio =
			precisionRatio !== null &&
			recallRatio !== null &&
			precisionRatio + recallRatio > 0
				? (2 * precisionRatio * recallRatio) / (precisionRatio + recallRatio)
				: null;

		const precision = precisionRatio !== null ? precisionRatio * 100 : null;
		const recall = recallRatio !== null ? recallRatio * 100 : null;
		const f1 = f1Ratio !== null ? f1Ratio * 100 : null;

		if (precision !== null) {
			precisionSum += precision;
			precisionCount += 1;
		}
		if (recall !== null) {
			recallSum += recall;
			recallCount += 1;
		}
		if (f1 !== null) {
			f1Sum += f1;
			f1Count += 1;
		}

		perClassMetrics[label] = { precision, recall, f1 };
	}

	const accuracy =
		evaluatedPredictions > 0
			? (correctPredictions / evaluatedPredictions) * 100
			: null;
	const precisionMacro =
		precisionCount > 0 ? precisionSum / precisionCount : null;
	const recallMacro = recallCount > 0 ? recallSum / recallCount : null;
	const f1Macro = f1Count > 0 ? f1Sum / f1Count : null;

	return {
		xbdId,
		totalBuildings: features.length,
		damageDistribution: predictedDistribution,
		actualDamageDistribution: actualDistribution,
		evaluatedPredictions,
		correctPredictions,
		accuracy,
		precisionMacro,
		recallMacro,
		f1Macro,
		perClassMetrics,
		confusionMatrix,
		matrixTotal: evaluatedPredictions,
		matrixMax,
	};
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView({
	initialDisasterId,
	selectedXbdId,
	onXbdChange,
	initialBuildingUid,
	onInitialBuildingHandled,
	onSceneError,
	onMetricsChange,
	xbdSelectorStatus,
	xbdIds,
	canGoPrev,
	canGoNext,
	onPrev,
	onNext,
	chatCommand,
}: MapViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const compareRef = useRef<Compare | null>(null);
	const compareIdleTimerRef = useRef<number | null>(null);
	const beforeMapRef = useRef<mapboxgl.Map | null>(null);
	const afterMapRef = useRef<mapboxgl.Map | null>(null);
	const layersReadyRef = useRef(false);

	const [disasterId, setDisasterId] = useState(initialDisasterId);
	const [sceneLoading, setSceneLoading] = useState(false);
	const [bootstrapRetryCount, setBootstrapRetryCount] = useState(0);
	const [sceneRetryCount, setSceneRetryCount] = useState(0);
	const [buildingsVisible, setBuildingsVisible] = useState(true);
	const [imageryVisible, setImageryVisible] = useState(true);
	const [compareIdle, setCompareIdle] = useState(false);
	const [status, setStatus] = useState<MapStatus>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [popupData, setPopupData] = useState<PopupData | null>(null);
	const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(
		null,
	);

	const loadingOverlay = useLoadingOverlay(status);
	const popupDataRef = useRef<PopupData | null>(null);
	const selectedBuildingIdRef = useRef<string | number | null>(null);
	const highlightedBuildingIdsRef = useRef<Array<string | number>>([]);
	const imageryVisibleRef = useRef(imageryVisible);
	const boundsRef = useRef<ImageBounds | null>(null);
	const scheduleCompareIdleRef = useRef<() => void>(() => {});
	imageryVisibleRef.current = imageryVisible;
	const bootstrapRetryCountRef = useRef(bootstrapRetryCount);
	const sceneRetryCountRef = useRef(sceneRetryCount);
	bootstrapRetryCountRef.current = bootstrapRetryCount;
	sceneRetryCountRef.current = sceneRetryCount;

	useEffect(() => {
		setDisasterId(initialDisasterId);
	}, [initialDisasterId]);

	const updatePopupPos = useCallback(() => {
		if (popupDataRef.current && afterMapRef.current) {
			const { x, y } = afterMapRef.current.project(popupDataRef.current.lngLat);
			setPopupPos({ x, y });
		}
	}, []);

	const scheduleCompareIdle = useCallback(() => {
		if (compareIdleTimerRef.current !== null) {
			window.clearTimeout(compareIdleTimerRef.current);
		}
		setCompareIdle(false);
		compareIdleTimerRef.current = window.setTimeout(() => {
			setCompareIdle(true);
		}, 2000);
	}, []);
	scheduleCompareIdleRef.current = scheduleCompareIdle;

	const closePopup = useCallback(() => {
		const id = selectedBuildingIdRef.current;
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (id !== null && before && after) {
			before.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id },
				{ selected: false },
			);
			after.setFeatureState(
				{ source: BUILDINGS_SOURCE_ID, id },
				{ selected: false },
			);
		}
		selectedBuildingIdRef.current = null;
		popupDataRef.current = null;
		setPopupData(null);
		setPopupPos(null);
	}, []);

	const openPopup = useCallback(
		(data: PopupData) => {
			popupDataRef.current = data;
			setPopupData(data);
			updatePopupPos();
		},
		[updatePopupPos],
	);

	const handleToggle = useCallback(() => {
		closePopup();
		setBuildingsVisible((prev) => {
			const next = !prev;
			if (
				layersReadyRef.current &&
				beforeMapRef.current &&
				afterMapRef.current
			) {
				setBuildingVisibility(beforeMapRef.current, next);
				setBuildingVisibility(afterMapRef.current, next);
			}
			return next;
		});
	}, [closePopup]);

	const handleImageryToggle = useCallback(() => {
		setImageryVisible((prev) => {
			const next = !prev;
			if (
				layersReadyRef.current &&
				beforeMapRef.current &&
				afterMapRef.current
			) {
				setImageryVisibility(beforeMapRef.current, PRE_IMAGE_LAYER_ID, next);
				setImageryVisibility(afterMapRef.current, POST_IMAGE_LAYER_ID, next);
				setSatelliteOpacity(beforeMapRef.current, next);
				setSatelliteOpacity(afterMapRef.current, next);
			}
			return next;
		});
	}, []);

	const handleResetView = useCallback(() => {
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		const bounds = boundsRef.current;
		if (!before || !after || !bounds) return;

		before.fitBounds([bounds.sw, bounds.ne], { padding: 0, animate: true });
		after.fitBounds([bounds.sw, bounds.ne], { padding: 0, animate: true });
	}, []);

	const xbdIdRef = useRef(selectedXbdId);
	xbdIdRef.current = selectedXbdId;
	const normalizedInitialBuildingUid = useMemo(
		() => initialBuildingUid?.trim() || undefined,
		[initialBuildingUid],
	);

	useEffect(() => {
		if (!containerRef.current) return;

		const buildingUidForInitialSelect = normalizedInitialBuildingUid;
		const retryCountAtStart = bootstrapRetryCount;

		let cancelled = false;
		const abortController = new AbortController();
		let beforeMap: mapboxgl.Map | null = null;
		let afterMap: mapboxgl.Map | null = null;

		setStatus("loading");
		setErrorMessage(null);
		onMetricsChange?.(null);

		fetchMapData(disasterId, xbdIdRef.current, {
			signal: abortController.signal,
		})
			.then(({ imagePair, buildings, bounds }) => {
				if (!imagePair || !bounds) {
					throw new Error(
						"The requested scene coordinates or imagery could not be found.",
					);
				}
				if (
					cancelled ||
					retryCountAtStart !== bootstrapRetryCountRef.current ||
					!containerRef.current
				)
					return;
				boundsRef.current = bounds;

				containerRef.current.innerHTML = "";
				const beforeDiv = document.createElement("div");
				const afterDiv = document.createElement("div");
				Object.assign(beforeDiv.style, { position: "absolute", inset: "0" });
				Object.assign(afterDiv.style, { position: "absolute", inset: "0" });
				containerRef.current.appendChild(beforeDiv);
				containerRef.current.appendChild(afterDiv);

				beforeMap = createMapInstance(beforeDiv, imageryVisibleRef, {
					withResetBoundsControl: true,
					onResetView: handleResetView,
				});
				beforeMapRef.current = beforeMap;
				afterMap = createMapInstance(afterDiv, imageryVisibleRef, {
					withResetBoundsControl: true,
					onResetView: handleResetView,
				});
				afterMapRef.current = afterMap;

				const { coordinates, sw, ne } = bounds;
				const preImageUrl = resolveImageUrl(
					imagePair.properties.pre_image_path,
				);
				const postImageUrl = resolveImageUrl(
					imagePair.properties.post_image_path,
				);

				const _before = beforeMap;
				const _after = afterMap;

				const onMapsLoaded = () => {
					if (cancelled || retryCountAtStart !== bootstrapRetryCountRef.current)
						return;

					addInitialSourcesAndLayers({
						beforeMap: _before,
						afterMap: _after,
						preImageUrl,
						postImageUrl,
						coordinates,
						buildings,
					});

					layersReadyRef.current = true;
					setBuildingsVisible((current) => {
						setBuildingVisibility(_before, current);
						setBuildingVisibility(_after, current);
						return current;
					});
					setImageryVisible((current) => {
						setImageryVisibility(_before, PRE_IMAGE_LAYER_ID, current);
						setImageryVisibility(_after, POST_IMAGE_LAYER_ID, current);
						setSatelliteOpacity(_before, current);
						setSatelliteOpacity(_after, current);
						return current;
					});

					setStatus("ready");
					onMetricsChange?.(
						computeSceneMetrics(imagePair.properties.xbd_id, buildings),
					);
					bindBuildingInteractions({
						beforeMap: _before,
						afterMap: _after,
						onPopupOpen: openPopup,
						onPopupPositionUpdate: updatePopupPos,
						selectedBuildingIdRef,
					});

					if (containerRef.current) {
						compareRef.current = createCompareInstance({
							beforeMap: _before,
							afterMap: _after,
							container: containerRef.current,
						});
						scheduleCompareIdleRef.current();
					}

					_before.fitBounds([sw, ne], { padding: 0, animate: false });

					_after.once("idle", () => {
						if (
							cancelled ||
							retryCountAtStart !== bootstrapRetryCountRef.current
						)
							return;
						if (buildingUidForInitialSelect) {
							const buildingSelected = selectBuildingByUid({
								beforeMap: _before,
								afterMap: _after,
								uid: buildingUidForInitialSelect,
								selectedBuildingIdRef,
								onPopupOpen: openPopup,
							});
							if (!buildingSelected) {
								toast.warning(
									`"${buildingUidForInitialSelect}" is not a valid building ID.`,
									{ id: "invalid-building-id" },
								);
							}
							onInitialBuildingHandled?.();
						}
					});
				};

				return waitForMapsLoad(_before, _after).then(onMapsLoaded);
			})
			.catch((err: unknown) => {
				if (cancelled || retryCountAtStart !== bootstrapRetryCountRef.current)
					return;
				if (err instanceof DOMException && err.name === "AbortError") return;

				const errorMsg =
					err instanceof Error ? err.message : "Scene imagery unavailable.";

				// 2. Check if the error is a "not found" (404)
				if (errorMsg.includes("404") || errorMsg.includes("not found")) {
					if (onSceneError) {
						onSceneError(
							`Scene ${xbdIdRef.current} not found. Returning to default.`,
						);
						return; // Stop here so we don't show the local error overlay
					}
				}

				setErrorMessage(errorMsg);
				setStatus("error");
				onMetricsChange?.(null);
			});

		return () => {
			cancelled = true;
			abortController.abort();
			if (compareIdleTimerRef.current !== null) {
				window.clearTimeout(compareIdleTimerRef.current);
				compareIdleTimerRef.current = null;
			}
			selectedBuildingIdRef.current = null;
			highlightedBuildingIdsRef.current = [];
			boundsRef.current = null;
			layersReadyRef.current = false;
			compareRef.current?.remove();
			beforeMap?.remove();
			afterMap?.remove();
			beforeMapRef.current = null;
			afterMapRef.current = null;
		};
		// selectedXbdId is intentionally excluded; scene switches are handled by Effect 2.
	}, [
		openPopup,
		updatePopupPos,
		handleResetView,
		onSceneError,
		onMetricsChange,
		disasterId,
		bootstrapRetryCount,
		normalizedInitialBuildingUid,
		onInitialBuildingHandled,
	]);

	useEffect(() => {
		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (!before || !after || !layersReadyRef.current) return;
		const retryCountAtStart = sceneRetryCount;

		let cancelled = false;
		const abortController = new AbortController();
		setSceneLoading(true);
		closePopup();
		onMetricsChange?.(null);

		fetchMapData(disasterId, selectedXbdId, { signal: abortController.signal })
			.then(({ imagePair, buildings, bounds }) => {
				if (
					cancelled ||
					retryCountAtStart !== sceneRetryCountRef.current ||
					!beforeMapRef.current ||
					!afterMapRef.current
				)
					return;
				boundsRef.current = bounds;

				const _before = beforeMapRef.current;
				const _after = afterMapRef.current;
				const preImageUrl = resolveImageUrl(
					imagePair.properties.pre_image_path,
				);
				const postImageUrl = resolveImageUrl(
					imagePair.properties.post_image_path,
				);
				const { coordinates, sw, ne } = bounds;

				(_before.getSource("pre-image") as mapboxgl.ImageSource).updateImage({
					url: preImageUrl,
					coordinates,
				});
				(_after.getSource("post-image") as mapboxgl.ImageSource).updateImage({
					url: postImageUrl,
					coordinates,
				});

				selectedBuildingIdRef.current = null;
				popupDataRef.current = null;
				setPopupData(null);
				setPopupPos(null);

				const beforeSource = _before.getSource(
					BUILDINGS_SOURCE_ID,
				) as mapboxgl.GeoJSONSource;
				const afterSource = _after.getSource(
					BUILDINGS_SOURCE_ID,
				) as mapboxgl.GeoJSONSource;

				beforeSource.setData({ type: "FeatureCollection", features: [] });
				afterSource.setData({ type: "FeatureCollection", features: [] });
				beforeSource.setData(buildings);
				afterSource.setData(buildings);

				_before.fitBounds([sw, ne], { padding: 0, animate: true });
				setErrorMessage(null);
				setStatus("ready");
				onMetricsChange?.(
					computeSceneMetrics(imagePair.properties.xbd_id, buildings),
				);
			})
			.catch((err: unknown) => {
				if (cancelled || retryCountAtStart !== sceneRetryCountRef.current)
					return;
				if (err instanceof DOMException && err.name === "AbortError") return;

				const errorMsg = err instanceof Error ? err.message : String(err);

				// SPECIFIC CHECK: The Disaster exists, but this specific Scene number does not
				if (
					errorMsg.includes("404") ||
					errorMsg.toLowerCase().includes("not found")
				) {
					if (onSceneError) {
						onSceneError(
							`Scene #${xbdIdRef.current} is not available for this disaster. Returning to default view.`,
						);
						return;
					}
				}

				// Generic fallback for network issues/server crashes
				toast.error("Map Data Error: Unable to fetch satellite imagery.");
				setErrorMessage(errorMsg);
				setStatus("error");
				onMetricsChange?.(null);
			})
			.finally(() => {
				if (!cancelled && retryCountAtStart === sceneRetryCountRef.current) {
					setSceneLoading(false);
				}
			});

		return () => {
			cancelled = true;
			abortController.abort();
		};
	}, [
		selectedXbdId,
		disasterId,
		sceneRetryCount,
		closePopup,
		onSceneError,
		onMetricsChange,
	]);

	useEffect(() => {
		if (!imageryVisible) {
			if (compareIdleTimerRef.current !== null) {
				window.clearTimeout(compareIdleTimerRef.current);
				compareIdleTimerRef.current = null;
			}
			setCompareIdle(false);
			return;
		}

		scheduleCompareIdle();
		const container = containerRef.current;
		if (!container) return;

		const handleActivity = () => {
			scheduleCompareIdle();
		};

		container.addEventListener("pointerdown", handleActivity);
		container.addEventListener("pointermove", handleActivity);
		container.addEventListener("touchstart", handleActivity);

		return () => {
			container.removeEventListener("pointerdown", handleActivity);
			container.removeEventListener("pointermove", handleActivity);
			container.removeEventListener("touchstart", handleActivity);
		};
	}, [imageryVisible, scheduleCompareIdle]);

	useEffect(() => {
		if (!chatCommand || status !== "ready" || sceneLoading) return;
		if (chatCommand.targetXbdId && chatCommand.targetXbdId !== selectedXbdId) {
			return;
		}

		const before = beforeMapRef.current;
		const after = afterMapRef.current;
		if (!before || !after || !layersReadyRef.current) return;

		setBuildingsVisible((current) => {
			if (!current) {
				setBuildingVisibility(before, true);
				setBuildingVisibility(after, true);
			}
			return true;
		});

		setHighlightedBuildingsByUid({
			beforeMap: before,
			afterMap: after,
			uids: chatCommand.highlightedBuildingIds,
			highlightedBuildingIdsRef,
		});

		if (chatCommand.highlightedBuildingGeometries.length > 0) {
			const bounds = new mapboxgl.LngLatBounds();
			for (const geometry of chatCommand.highlightedBuildingGeometries) {
				extendBoundsWithGeometry(bounds, geometry);
			}
			if (!bounds.isEmpty()) {
				before.fitBounds(bounds, {
					padding: CHAT_FIT_PADDING,
					duration: 1200,
					maxZoom: CHAT_FOCUS_FALLBACK_ZOOM,
				});
				after.fitBounds(bounds, {
					padding: CHAT_FIT_PADDING,
					duration: 1200,
					maxZoom: CHAT_FOCUS_FALLBACK_ZOOM,
				});
			}
		} else if (chatCommand.focus) {
			const center: [number, number] = [
				chatCommand.focus.lon,
				chatCommand.focus.lat,
			];
			const nextZoom = Math.max(before.getZoom(), CHAT_FOCUS_FALLBACK_ZOOM);
			before.easeTo({ center, zoom: nextZoom, duration: 1200 });
			after.easeTo({ center, zoom: nextZoom, duration: 1200 });
		}

		if (chatCommand.targetBuildingUid) {
			selectBuildingByUid({
				beforeMap: before,
				afterMap: after,
				uid: chatCommand.targetBuildingUid,
				selectedBuildingIdRef,
				onPopupOpen: openPopup,
			});
		}
	}, [chatCommand, openPopup, sceneLoading, selectedXbdId, status]);

	return (
		<div
			className={`map-wrapper w-full relative${
				compareIdle ? " map-wrapper--compare-idle" : ""
			}`}
			style={{ height: "80vh" }}
			data-imagery-visible={imageryVisible ? "true" : "false"}
			data-compare-idle={compareIdle ? "true" : "false"}
		>
			<div ref={containerRef} className="map-container w-full h-full" />

			<MapControls
				selectedXbdId={selectedXbdId}
				onXbdChange={onXbdChange}
				xbdSelectorStatus={xbdSelectorStatus}
				xbdIds={xbdIds}
				canGoPrev={canGoPrev}
				canGoNext={canGoNext}
				onPrev={onPrev}
				onNext={onNext}
				sceneDisabled={status !== "ready"}
				sceneLoading={sceneLoading}
				imageryVisible={imageryVisible}
				onImageryToggle={handleImageryToggle}
				buildingsVisible={buildingsVisible}
				onBuildingsToggle={handleToggle}
				visible={status === "ready"}
			/>

			<MapLoadingOverlay {...loadingOverlay} />

			{status === "error" && errorMessage && (
				<div
					className="map-status-overlay map-status-overlay--error"
					role="alert"
				>
					<p>
						<strong>Failed to load map.</strong>
					</p>
					<p>{errorMessage}</p>
					<button
						type="button"
						onClick={() => {
							setStatus("loading");
							setErrorMessage(null);
							if (layersReadyRef.current) {
								setSceneRetryCount((c) => c + 1);
								return;
							}
							setBootstrapRetryCount((c) => c + 1);
						}}
					>
						Retry
					</button>
				</div>
			)}

			{popupData && popupPos && (
				<div
					className="popup-overlay"
					style={{ left: popupPos.x, top: popupPos.y }}
				>
					<BuildingPopup
						uid={popupData.uid}
						address={popupData.address}
						predictedDamage={popupData.predictedDamage}
						predictedDamageColor={popupData.predictedDamageColor}
						actualDamage={popupData.actualDamage}
						actualDamageColor={popupData.actualDamageColor}
						onClose={closePopup}
					/>
				</div>
			)}
		</div>
	);
}
