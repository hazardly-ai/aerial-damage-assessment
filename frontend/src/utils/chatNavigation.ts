import type {
	ChatAction,
	ChatHighlightedBuilding,
	ChatMapCommand,
	ChatResponse,
} from "@/types/chat";

const getResolvedTargetXbdId = (
	action: ChatAction | undefined,
	buildings: ChatHighlightedBuilding[],
): number | null => {
	if (typeof action?.params?.xbd_id === "number") {
		return action.params.xbd_id;
	}

	const counts = new Map<number, number>();
	for (const building of buildings) {
		if (typeof building.xbd_id !== "number") continue;
		counts.set(building.xbd_id, (counts.get(building.xbd_id) ?? 0) + 1);
	}

	let bestXbdId: number | null = null;
	let bestCount = -1;
	for (const [xbdId, count] of counts.entries()) {
		if (count > bestCount) {
			bestXbdId = xbdId;
			bestCount = count;
		}
	}

	return bestXbdId;
};

export const buildChatNavigationUrl = (
	response: ChatResponse,
): string | null => {
	if (response.action?.url) {
		return response.action.url;
	}

	const disasterName = response.action?.params?.disaster_name?.trim();
	const targetXbdId = getResolvedTargetXbdId(
		response.action,
		response.highlighted_buildings,
	);
	const buildingUid = response.action?.params?.building_uid?.trim();

	if (!disasterName) {
		return null;
	}

	const basePath =
		typeof targetXbdId === "number"
			? `/map/${encodeURIComponent(disasterName)}/${encodeURIComponent(String(targetXbdId))}`
			: `/map/${encodeURIComponent(disasterName)}`;

	if (!buildingUid || typeof targetXbdId !== "number") {
		return basePath;
	}

	return `${basePath}?building=${encodeURIComponent(buildingUid)}`;
};

export const buildChatCommand = (response: ChatResponse): ChatMapCommand => {
	const targetXbdId = getResolvedTargetXbdId(
		response.action,
		response.highlighted_buildings,
	);
	const buildingsForScene =
		typeof targetXbdId === "number"
			? response.highlighted_buildings.filter(
					(building) => building.xbd_id === targetXbdId,
				)
			: response.highlighted_buildings;

	const highlightedBuildingIds = buildingsForScene
		.map((building) => building.uid?.trim())
		.filter((uid): uid is string => Boolean(uid));
	const highlightedBuildingGeometries = buildingsForScene
		.map((building) => building.geometry)
		.filter((geometry): geometry is GeoJSON.Geometry => geometry !== undefined);
	const actionBuildingUid =
		response.action?.params?.building_uid?.trim() ?? null;
	const targetBuildingUid =
		actionBuildingUid &&
		buildingsForScene.some((building) => building.uid === actionBuildingUid)
			? actionBuildingUid
			: buildingsForScene.length === 1
				? (buildingsForScene[0]?.uid?.trim() ?? null)
				: null;

	return {
		id: crypto.randomUUID(),
		focus: response.focus,
		highlightedBuildingIds,
		highlightedBuildingGeometries,
		targetXbdId,
		targetBuildingUid,
	};
};
