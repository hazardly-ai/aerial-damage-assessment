import type {
	DamageLevel,
	NormalizedDamage,
} from "@/utils/classificationMetrics";

export type { DamageLevel, NormalizedDamage };

export type BuildingListItem = {
	id: number;
	uid: string;
	address?: string | null;
	image_pair_id: number;
	xbd_id: number;
	disaster_name: string;
	actual_damage: NormalizedDamage;
	predicted_damage?: NormalizedDamage | null;
	is_correct?: boolean | null;
	created_at?: string | null;
	pre_image_path?: string | null;
	post_image_path?: string | null;
};

export type ImagePairRow = {
	id: number;
	xbd_id: number;
	pre_image_path?: string | null;
	post_image_path?: string | null;
	totalBuildings: number;
	correctCount: number;
	incorrectCount: number;
	comparedCount: number;
	accuracyPct: string | null;
};

export type ImagePairSortKey =
	| "xbd_id"
	| "totalBuildings"
	| "correctCount"
	| "incorrectCount"
	| "accuracyPct";

export type SortDirection = "asc" | "desc";

export type ActiveSection = "overview" | "buildings" | "image-pairs";

export type BuildingCorrectnessFilter = "all" | "yes" | "no";

export type OverviewDamageRow = {
	key: string;
	label: string;
	actualCount: number;
	actualPercentage: string;
	predictedCount: number;
	predictedPercentage: string;
	classAccuracy: string;
	color: string;
};

export type MacroDamageMetrics = {
	available: boolean;
	precisionMacroPct: string | null;
	recallMacroPct: string | null;
	f1MacroPct: string | null;
};

export interface PredictionMetrics {
	correctCount: number;
	comparedCount: number;
	accuracyPct: string;
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>;
	available: boolean;
	matrixTotal: number;
	matrixMax: number;
	macroMetrics: MacroDamageMetrics;
}
