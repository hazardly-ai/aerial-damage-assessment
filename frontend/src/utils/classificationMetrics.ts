import type { BuildingFeature } from "@/utils/hazardlyApi";

export const DAMAGE_CLASSES = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
] as const;

export type DamageLevel = (typeof DAMAGE_CLASSES)[number];
export type NormalizedDamage = DamageLevel | "un-classified";

/** Row/column order for confusion matrices and macro metrics. */
export const CONFUSION_LABELS: DamageLevel[] = [...DAMAGE_CLASSES];

const KNOWN_CLASS_KEYS = new Set<string>(DAMAGE_CLASSES);

const DAMAGE_SYNONYMS: Record<string, NormalizedDamage> = {
	"no-damage": "no-damage",
	"no-damages": "no-damage",
	"minor-damage": "minor-damage",
	"minor-damages": "minor-damage",
	"major-damage": "major-damage",
	"major-damages": "major-damage",
	destroyed: "destroyed",
	destroy: "destroyed",
	"un-classified": "un-classified",
	unclassified: "un-classified",
	unknown: "un-classified",
	uncertain: "un-classified",
};

export const normalizeDamage = (raw?: string | null): NormalizedDamage => {
	if (!raw) return "un-classified";

	const normalized = raw
		.toLowerCase()
		.trim()
		.replace(/[_\s]+/g, "-")
		.replace(/-+/g, "-");

	const mappedDamage = DAMAGE_SYNONYMS[normalized];
	if (mappedDamage) return mappedDamage;

	if (KNOWN_CLASS_KEYS.has(normalized)) {
		return normalized as NormalizedDamage;
	}

	return "un-classified";
};

export function isDamageLevel(value: NormalizedDamage): value is DamageLevel {
	return value !== "un-classified";
}

export const createEmptyConfusionMatrix = (): Record<
	DamageLevel,
	Record<DamageLevel, number>
> => ({
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
});

export type PerClassPrf = {
	precision: number | null;
	recall: number | null;
	f1: number | null;
};

export const perClassAndMacroFromConfusion = (
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>,
): {
	perClassMetrics: Record<DamageLevel, PerClassPrf>;
	precisionMacro: number | null;
	recallMacro: number | null;
	f1Macro: number | null;
} => {
	const perClassMetrics: Record<DamageLevel, PerClassPrf> = {
		"no-damage": { precision: null, recall: null, f1: null },
		"minor-damage": { precision: null, recall: null, f1: null },
		"major-damage": { precision: null, recall: null, f1: null },
		destroyed: { precision: null, recall: null, f1: null },
	};
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

		perClassMetrics[label] = { precision, recall, f1 };

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
	}

	return {
		perClassMetrics,
		precisionMacro: precisionCount > 0 ? precisionSum / precisionCount : null,
		recallMacro: recallCount > 0 ? recallSum / recallCount : null,
		f1Macro: f1Count > 0 ? f1Sum / f1Count : null,
	};
};

export const macroPrfPercentFromConfusion = (
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>,
): {
	precisionMacro: number | null;
	recallMacro: number | null;
	f1Macro: number | null;
} => {
	const { precisionMacro, recallMacro, f1Macro } =
		perClassAndMacroFromConfusion(confusionMatrix);
	return { precisionMacro, recallMacro, f1Macro };
};

export function confusionMatrixMax(
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>,
): number {
	let matrixMax = 0;
	for (const actualLabel of DAMAGE_CLASSES) {
		for (const predictedLabel of DAMAGE_CLASSES) {
			const value = confusionMatrix[actualLabel][predictedLabel];
			if (value > matrixMax) matrixMax = value;
		}
	}
	return matrixMax;
}

function emptyClassDistribution(): Record<DamageLevel, number> {
	return {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};
}

/**
 * Single source of truth for confusion counts, accuracy inputs, distributions,
 * and macro / per-class metrics from building features (map scene or full disaster).
 */
export function rollupBuildingClassificationMetrics(
	features: BuildingFeature[],
): {
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>;
	matrixMax: number;
	comparedCount: number;
	correctCount: number;
	predictedDistribution: Record<DamageLevel, number>;
	actualDistribution: Record<DamageLevel, number>;
	precisionMacro: number | null;
	recallMacro: number | null;
	f1Macro: number | null;
	perClassMetrics: Record<DamageLevel, PerClassPrf>;
} {
	const confusionMatrix = createEmptyConfusionMatrix();
	const predictedDistribution = emptyClassDistribution();
	const actualDistribution = emptyClassDistribution();

	let comparedCount = 0;
	let correctCount = 0;

	for (const feature of features) {
		const rawPredicted = feature.properties.predicted_damage;
		const actual = normalizeDamage(feature.properties.actual_damage);
		const predicted =
			rawPredicted == null
				? ("un-classified" as const)
				: normalizeDamage(rawPredicted);

		if (isDamageLevel(predicted)) {
			predictedDistribution[predicted] += 1;
		}
		if (isDamageLevel(actual)) {
			actualDistribution[actual] += 1;
		}

		if (rawPredicted == null) continue;
		if (!isDamageLevel(actual) || !isDamageLevel(predicted)) continue;

		comparedCount += 1;
		if (actual === predicted) correctCount += 1;
		confusionMatrix[actual][predicted] += 1;
	}

	const matrixMax = confusionMatrixMax(confusionMatrix);
	const { precisionMacro, recallMacro, f1Macro, perClassMetrics } =
		perClassAndMacroFromConfusion(confusionMatrix);

	return {
		confusionMatrix,
		matrixMax,
		comparedCount,
		correctCount,
		predictedDistribution,
		actualDistribution,
		precisionMacro,
		recallMacro,
		f1Macro,
		perClassMetrics,
	};
}
