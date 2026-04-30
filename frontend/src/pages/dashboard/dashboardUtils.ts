import { DAMAGE_COLOR_HEX } from "@/constants/app";
import type {
	BuildingFeature,
	BuildingStatsResponse,
} from "@/utils/hazardlyApi";
import type {
	DamageLevel,
	ImagePairRow,
	NormalizedDamage,
	OverviewDamageRow,
} from "./dashboardTypes";

export const CONFUSION_LABELS: DamageLevel[] = [
	"no-damage",
	"minor-damage",
	"major-damage",
	"destroyed",
];

export const PAGE_SIZE = 25;

export const DAMAGE_FILTERS: Array<{ key: string; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "no-damage", label: "No Damage" },
	{ key: "minor-damage", label: "Minor Damage" },
	{ key: "major-damage", label: "Major Damage" },
	{ key: "destroyed", label: "Destroyed" },
];

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

export const prettyLabel = (value: string): string =>
	value
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

export const normalizeDamage = (raw?: string | null): NormalizedDamage => {
	if (!raw) return "un-classified";

	const normalized = raw
		.toLowerCase()
		.trim()
		.replace(/[_\s]+/g, "-")
		.replace(/-+/g, "-");

	const mappedDamage = DAMAGE_SYNONYMS[normalized];
	if (mappedDamage) return mappedDamage;

	if (DAMAGE_FILTERS.some((item) => item.key === normalized)) {
		return normalized as NormalizedDamage;
	}

	return "un-classified";
};

export const toPct = (value: number, total: number): string => {
	if (total <= 0) return "0.0";
	return ((value / total) * 100).toFixed(1);
};

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

export const buildStatsFromFeatures = (
	features: BuildingFeature[],
): BuildingStatsResponse => {
	const byDamage: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};

	for (const feature of features) {
		const key = normalizeDamage(feature.properties.actual_damage);
		if (key === "un-classified") continue;
		byDamage[key] = (byDamage[key] ?? 0) + 1;
	}

	return {
		total: features.length,
		no_damage: byDamage["no-damage"] ?? 0,
		by_damage: byDamage,
	};
};

export const buildOverviewDamageRows = ({
	stats,
	allBuildingsCache,
	confusionMatrix,
}: {
	stats: BuildingStatsResponse;
	allBuildingsCache: BuildingFeature[] | null;
	confusionMatrix: Record<DamageLevel, Record<DamageLevel, number>>;
}): OverviewDamageRow[] => {
	const predictedByDamage: Record<string, number> = {
		"no-damage": 0,
		"minor-damage": 0,
		"major-damage": 0,
		destroyed: 0,
	};

	let predictedTotal = 0;
	for (const feature of allBuildingsCache ?? []) {
		const rawPredicted = feature.properties.predicted_damage;
		if (rawPredicted == null) continue;
		const key = normalizeDamage(rawPredicted);
		if (key === "un-classified") continue;
		predictedByDamage[key] = (predictedByDamage[key] ?? 0) + 1;
		predictedTotal += 1;
	}

	return DAMAGE_FILTERS.filter((item) => item.key !== "all").map((item) => {
		const actualCount = stats.by_damage[item.key] ?? 0;
		const predictedCount = predictedByDamage[item.key] ?? 0;
		const classKey = item.key as DamageLevel;
		const actualTotalWithPrediction = CONFUSION_LABELS.reduce(
			(sum, predictedLabel) =>
				sum + (confusionMatrix[classKey][predictedLabel] ?? 0),
			0,
		);
		const diagonal = confusionMatrix[classKey][classKey] ?? 0;

		return {
			key: item.key,
			label: item.label,
			actualCount,
			actualPercentage: toPct(actualCount, stats.total),
			predictedCount,
			predictedPercentage: toPct(predictedCount, predictedTotal),
			classAccuracy:
				actualTotalWithPrediction > 0
					? `${toPct(diagonal, actualTotalWithPrediction)}%`
					: "0.0%",
			color: DAMAGE_COLOR_HEX[item.key] ?? "#9ca3af",
		};
	});
};

export const buildImagePairRows = ({
	allBuildingsCache,
	imagePairMap,
}: {
	allBuildingsCache: BuildingFeature[] | null;
	imagePairMap: Map<
		number,
		{
			xbd_id: number;
			pre_image_path?: string | null;
			post_image_path?: string | null;
		}
	>;
}): ImagePairRow[] => {
	if (!allBuildingsCache || imagePairMap.size === 0) return [];

	const counts = new Map<
		number,
		{ total: number; correct: number; incorrect: number; compared: number }
	>();

	for (const feature of allBuildingsCache) {
		const pairId = feature.properties.image_pair_id;
		const current = counts.get(pairId) ?? {
			total: 0,
			correct: 0,
			incorrect: 0,
			compared: 0,
		};
		current.total += 1;

		const actual = normalizeDamage(feature.properties.actual_damage);
		const rawPredicted = feature.properties.predicted_damage;
		if (rawPredicted != null) {
			const predicted = normalizeDamage(rawPredicted);
			if (actual !== "un-classified" && predicted !== "un-classified") {
				current.compared += 1;
				if (actual === predicted) {
					current.correct += 1;
				} else {
					current.incorrect += 1;
				}
			}
		}

		counts.set(pairId, current);
	}

	const rows = Array.from(imagePairMap.entries()).map(([id, pair]) => {
		const metrics = counts.get(id) ?? {
			total: 0,
			correct: 0,
			incorrect: 0,
			compared: 0,
		};

		return {
			id,
			xbd_id: pair.xbd_id,
			pre_image_path: pair.pre_image_path ?? null,
			post_image_path: pair.post_image_path ?? null,
			totalBuildings: metrics.total,
			correctCount: metrics.correct,
			incorrectCount: metrics.incorrect,
			comparedCount: metrics.compared,
			accuracyPct:
				metrics.compared > 0
					? ((metrics.correct / metrics.compared) * 100).toFixed(1)
					: null,
		};
	});

	rows.sort((a, b) => a.xbd_id - b.xbd_id);
	return rows;
};
