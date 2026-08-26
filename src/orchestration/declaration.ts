import type { ExecutionPolicy } from "./policy.js";

const AGENT_LABELS = {
	omcs_architect: "architect",
	omcs_fixer: "fixer",
	omcs_terra_fixer: "terra-fixer",
	omcs_designer: "designer",
	omcs_reviewer: "reviewer",
} as const;

function selectedAgents(policy: ExecutionPolicy): string[] {
	const agents: string[] = [AGENT_LABELS.omcs_architect];
	if (policy.route.implementer) agents.push(AGENT_LABELS[policy.route.implementer]);
	if (policy.route.reviewer) agents.push(AGENT_LABELS.omcs_reviewer);
	return agents;
}

/** Renders only policy-selected, non-secret fields in the stable route declaration format. */
export function renderRouteDeclaration(policy: ExecutionPolicy): string {
	return [
		"OMCS ROUTE",
		`profile: ${policy.profile}`,
		`mode: ${policy.route.mode}`,
		`risk: ${policy.risk}`,
		`skills: ${policy.skills.join(", ")}`,
		`agents: ${selectedAgents(policy).join(" → ")}`,
		"approval: material-decisions",
	].join("\n");
}
