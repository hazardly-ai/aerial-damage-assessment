export type MapStatus = "idle" | "loading" | "error" | "ready";

export interface SceneMetrics {
	xbdId: number;
	totalBuildings: number;
	damageDistribution: Record<string, number>;
	actualDamageDistribution: Record<string, number>;
	evaluatedPredictions: number;
	correctPredictions: number;
	accuracy: number | null;
}
