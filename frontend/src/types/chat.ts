export interface ChatFocus {
	lat: number;
	lon: number;
	address?: string;
}

export interface ChatHighlightedBuilding {
	id?: string;
	uid: string;
	xbd_id?: number | null;
	damage?: string;
	geometry?: GeoJSON.Geometry;
}

export interface ChatAction {
	type?: string;
	target?: string | null;
	reason?: string;
	url?: string | null;
	params?: {
		disaster_name?: string;
		xbd_id?: number | null;
		building_uid?: string;
		building_ids?: string[];
		lat?: number;
		lon?: number;
		address?: string;
		damage?: string;
	};
}

export interface ChatResponse {
	answer: string;
	response?: string;
	focus: ChatFocus | null;
	highlighted_buildings: ChatHighlightedBuilding[];
	action?: ChatAction;
}

export interface ChatMapCommand {
	id: string;
	focus: ChatFocus | null;
	highlightedBuildingIds: string[];
	highlightedBuildingGeometries: GeoJSON.Geometry[];
	targetXbdId?: number | null;
	targetBuildingUid?: string | null;
}

export interface ChatMessage {
	id: string;
	role: "fieldUser" | "responseAssistant";
	content: string;
	isPending?: boolean;
	mapCommandSummary?: string;
	suggestedActionLabel?: string;
	actionPayload?: ChatResponse;
}
