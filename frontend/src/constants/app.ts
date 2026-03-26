// Core application name (used in titles, metadata, etc.)
export const APP_NAME = "Aerial Damage Assessment";

// Team / organization branding
export const TEAM_NAME = "Hazardly AI";

// Short description of the application’s purpose
// Used for landing pages, metadata, or documentation
export const APP_DESCRIPTION =
	"Inspect, quantify, and analyze disaster damage with a unified dashboard " +
	"combining satellite imagery and AI damage classification.";

// Dataset powering the application
export const DATASET_NAME = "XView2 Dataset";

// Official dataset source link
export const DATASET_URL = "https://xview2.org/dataset";

// Organization GitHub link
export const GITHUB_URL = "https://github.com/hazardly-ai";

// Mapping of damage classifications to their corresponding hex color codes
export const DAMAGE_COLOR_HEX: Record<string, string> = {
	"no-damage": "#2ecc71",
	"minor-damage": "#f1c40f",
	"major-damage": "#e67e22",
	destroyed: "#e74c3c",
	"un-classified": "#95a5a6",
};

// Contributor type definition
// Ensures every contributor object has consistent fields
export type Contributor = {
	name: string;
	role: string;
	email: string;
	github: string;
};

// List of team members and their roles
// Centralized here so it can be reused across pages (About, Footer, etc.)
export const CONTRIBUTORS: Contributor[] = [
	{
		name: "Nishil Jaiswal",
		role: "Team Leader & Back-end",
		email: "nsj240001@utdallas.edu",
		github: "https://github.com/NishilJ",
	},
	{
		name: "Shiv Bhakta",
		role: "Back-end",
		email: "dal486719@utdallas.edu",
		github: "https://github.com/shivbhakta10",
	},
	{
		name: "James Harrison",
		role: "Front-end",
		email: "jth220000@utdallas.edu",
		github: "https://github.com/James5657",
	},
	{
		name: "Anoop Kondepudi",
		role: "Back-end",
		email: "dal500238@utdallas.edu",
		github: "https://github.com/Anoop-Kondepudi",
	},
	{
		name: "Natalie Larksukthom",
		role: "Front-end",
		email: "nxl220022@utdallas.edu",
		github: "https://github.com/TheNat20",
	},
	{
		name: "Shirya Vetapalem",
		role: "Back-end",
		email: "srv210000@utdallas.edu",
		github: "https://github.com/SRV1302",
	},
];
