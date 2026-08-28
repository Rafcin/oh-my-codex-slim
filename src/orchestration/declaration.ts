import type { CouncilAdviser, CouncilLane, ExecutionPolicy, PolicySkill, RiskEvidence, SupportingAgent } from "./policy.js";
import type { ExecutionProfile } from "../config/omcs-config.js";
import type { AuxiliaryAgent, RouteDecision, RouteFallback, RouteMode } from "./risk.js";

const AGENT_LABELS = {
	omcs_architect: "architect",
	omcs_fixer: "fixer",
	omcs_terra_fixer: "terra-fixer",
	omcs_designer: "designer",
	omcs_reviewer: "reviewer",
	omcs_explorer: "explorer",
	omcs_librarian: "librarian",
	omcs_oracle: "oracle",
} as const;

const PROFILES = new Set<ExecutionProfile>(["auto", "fast", "thorough", "council"]);
const MODES = new Set<RouteMode>(["solo", "delegate", "audit", "full"]);
const SKILLS = new Set<PolicySkill>(["context", "codebase-design", "research", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"]);
const SUPPORTING_AGENTS = new Set<SupportingAgent>(["omcs_explorer", "omcs_librarian", "omcs_oracle"]);
const AUXILIARY_AGENTS = new Set<AuxiliaryAgent>(["omcs_fixer", "omcs_terra_fixer", "omcs_designer", "omcs_reviewer", "omcs_explorer", "omcs_librarian", "omcs_oracle"]);
const COUNCIL_LANES = new Set<CouncilLane>(["native-sol", "native-luna", "native-terra"]);
const COUNCIL_ADVISERS = new Set<CouncilAdviser>(["native-sol-adviser", "native-luna-adviser", "native-terra-adviser"]);
const COUNCIL_ADVISER_BY_LANE: Record<CouncilLane, CouncilAdviser> = {
	"native-sol": "native-sol-adviser",
	"native-luna": "native-luna-adviser",
	"native-terra": "native-terra-adviser",
};

function isStringArray(value: unknown, allowed: ReadonlySet<string>): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item));
}

function isUnique(values: readonly string[]): boolean {
	return new Set(values).size === values.length;
}

function validRoute(route: unknown): route is RouteDecision {
	if (typeof route !== "object" || route === null || !("mode" in route) || !MODES.has(route.mode as RouteMode)) return false;
	const candidate = route as Record<string, unknown>;
	const implementer = candidate.implementer;
	const reviewer = candidate.reviewer;
	const fallback = candidate.fallback;
	return (implementer === undefined || implementer === "omcs_fixer" || implementer === "omcs_terra_fixer" || implementer === "omcs_designer")
		&& (reviewer === undefined || reviewer === "omcs_reviewer")
		&& (fallback === undefined || validFallback(fallback));
}

function validFallback(value: unknown): value is RouteFallback {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (candidate.unavailable === "omcs_fixer" || candidate.unavailable === "omcs_terra_fixer" || candidate.unavailable === "omcs_designer")
		&& (candidate.from === "delegate" || candidate.from === "full")
		&& candidate.reason === "optional-capability-unavailable";
}

function validRisk(risk: unknown): risk is RiskEvidence {
	if (typeof risk !== "object" || risk === null) return false;
	const candidate = risk as Record<string, unknown>;
	return (candidate.blastRadius === "narrow" || candidate.blastRadius === "moderate" || candidate.blastRadius === "wide")
		&& (candidate.consequence === "low" || candidate.consequence === "material")
		&& (candidate.uncertainty === "low" || candidate.uncertainty === "material")
		&& typeof candidate.unsettled === "boolean"
		&& typeof candidate.visual === "boolean"
		&& typeof candidate.research === "boolean"
		&& typeof candidate.concreteSlopFinding === "boolean";
}

function validBudget(budget: unknown): boolean {
	if (typeof budget !== "object" || budget === null) return false;
	const candidate = budget as Record<string, unknown>;
	return (candidate.maxAuxiliaries === 1 || candidate.maxAuxiliaries === 2)
		&& candidate.oneFinalVerificationPath === true
		&& candidate.repeatVerificationOnlyAfterInputChange === true
		&& candidate.postGreenEdits === "named-finding-only";
}

function validCapabilities(policy: ExecutionPolicy): boolean {
	const value: unknown = policy.capabilities;
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	const checked = candidate.checked;
	const available = candidate.available;
	if (!isStringArray(checked, AUXILIARY_AGENTS) || !isStringArray(available, AUXILIARY_AGENTS)) return false;
	if (!isUnique(checked) || !isUnique(available) || available.some((agent) => !checked.includes(agent))) return false;
	if (candidate.fallback !== null && !validFallback(candidate.fallback)) return false;
	return JSON.stringify(candidate.fallback) === JSON.stringify(policy.route.fallback ?? null);
}

function validCouncil(profile: ExecutionProfile, council: unknown): boolean {
	if (typeof council !== "object" || council === null) return false;
	const candidate = council as Record<string, unknown>;
	const advisers = candidate.advisers;
	const nativeLanes = candidate.nativeLanes;
	if (!isStringArray(advisers, COUNCIL_ADVISERS) || !isStringArray(nativeLanes, COUNCIL_LANES)) return false;
	if (candidate.status === "disabled") {
		return profile !== "council" && candidate.explicit === false && advisers.length === 0 && nativeLanes.length === 0;
	}
	if (candidate.status === "unavailable") {
		return profile === "council" && candidate.explicit === true && advisers.length === 0 && nativeLanes.length === 0;
	}
	if (candidate.status !== "enabled" || profile !== "council" || candidate.explicit !== true) return false;
	if (nativeLanes.length < 2 || advisers.length !== nativeLanes.length || !isUnique(nativeLanes) || !isUnique(advisers)) return false;
	return nativeLanes.every((lane, index) => advisers[index] === COUNCIL_ADVISER_BY_LANE[lane as CouncilLane]);
}

function assertRenderablePolicy(policy: ExecutionPolicy): void {
	if (!PROFILES.has(policy.profile) || !validRoute(policy.route) || !validRisk(policy.risk) || !isStringArray(policy.skills, SKILLS) || !isStringArray(policy.supportingAgents, SUPPORTING_AGENTS) || !validCouncil(policy.profile, policy.council) || !validBudget(policy.budget) || !validCapabilities(policy)) {
		throw new Error("Invalid OMCS route declaration policy");
	}
}

function selectedAgents(policy: ExecutionPolicy): string[] {
	const agents: string[] = [AGENT_LABELS.omcs_architect];
	if (policy.supportingAgents.length > 0) {
		agents.push(policy.supportingAgents.map((agent) => AGENT_LABELS[agent]).join(" + "));
	}
	if (policy.route.implementer) agents.push(AGENT_LABELS[policy.route.implementer]);
	if (policy.route.reviewer) agents.push(AGENT_LABELS.omcs_reviewer);
	return agents;
}

function renderRisk(risk: RiskEvidence): string {
	const reasons: string[] = [];
	if (risk.unsettled) reasons.push("unsettled scope");
	reasons.push(`${risk.consequence} consequence`);
	reasons.push(`${risk.uncertainty} uncertainty`);
	reasons.push(`${risk.blastRadius} blast radius`);
	if (risk.visual) reasons.push("visual change");
	if (risk.research) reasons.push("research required");
	if (risk.concreteSlopFinding) reasons.push("concrete cleanup finding");
	return reasons.join("; ");
}

function renderCouncil(policy: ExecutionPolicy): string {
	if (policy.council.status === "disabled") return "disabled";
	if (policy.council.status === "unavailable") return "unavailable (fail-closed)";
	return `enabled; advisers: ${policy.council.advisers.join(", ")}; lanes: ${policy.council.nativeLanes.join(", ")}`;
}

/** Renders only policy-selected, non-secret fields in the stable route declaration format. */
export function renderRouteDeclaration(policy: ExecutionPolicy): string {
	assertRenderablePolicy(policy);
	const lines = [
		"OMCS ROUTE",
		`profile: ${policy.profile}`,
		`mode: ${policy.route.mode}`,
		`risk: ${renderRisk(policy.risk)}`,
		`skills: ${policy.skills.join(", ")}`,
		`agents: ${selectedAgents(policy).join(" → ")}`,
		`budget: ${policy.budget.maxAuxiliaries} auxiliar${policy.budget.maxAuxiliaries === 1 ? "y" : "ies"}; one final verification path; stop after green`,
		`council: ${renderCouncil(policy)}`,
		"approval: material-decisions",
	];
	if (policy.route.fallback) lines.splice(6, 0, `fallback: ${policy.route.fallback.unavailable} unavailable; ${policy.route.fallback.from} → ${policy.route.mode}`);
	return lines.join("\n");
}
