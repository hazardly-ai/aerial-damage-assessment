export type MapStatus = "idle" | "loading" | "error" | "ready";

export interface SceneMetrics {
	xbdId: number;
	totalBuildings: number;
	damageDistribution: Record<string, number>;
	actualDamageDistribution: Record<string, number>;
	evaluatedPredictions: number;
	correctPredictions: number;
	accuracy: number | null;
	precisionMacro: number | null;
	recallMacro: number | null;
	f1Macro: number | null;
	perClassMetrics: Record<
		string,
		{
			precision: number | null;
			recall: number | null;
			f1: number | null;
		}
	>;
	confusionMatrix: Record<string, Record<string, number>>;
	matrixTotal: number;
	matrixMax: number;
}
