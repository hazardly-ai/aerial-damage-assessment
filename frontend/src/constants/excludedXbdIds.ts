// src/constants/excludedXbdIds.ts

export const EXCLUDED_XBD_IDS: Record<number, Set<number>> = {
	1: new Set([
		44, 58, 62, 63, 64, 68, 97, 120, 133, 135, 139, 143, 150, 161, 182, 185,
		225, 227, 259, 283, 298, 301, 303, 304, 305, 308, 310, 326, 331, 339, 341,
		342, 364, 368, 445, 466, 498, 504, 510, 516,
		//     image pairs with transparency
		33, 36, 37, 103, 192, 250, 254, 276, 314, 328, 420, 428, 441, 458, 464, 483,
		//     image pairs with no buildings
		93, 164, 166, 186, 246, 294, 324,
	]),
};
