import catalog from "./skills.json" with { type: "json" };

export interface SkillDefinition {
	name: string;
	description: string;
}

export const SKILL_CATALOG = catalog as readonly SkillDefinition[];
