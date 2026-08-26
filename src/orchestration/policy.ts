import type { ExecutionProfile } from "../config/omcs-config.js";
import { selectRoute, type BlastRadius, type RouteDecision, type RiskInput } from "./risk.js";

export type { RouteMode } from "./risk.js";

export interface WorkSignals {
	settled: boolean;
	blastRadius: BlastRadius;
	reviewRequired: boolean;
	visual: boolean;
	delegable: boolean;
	needsResearch: boolean;
	hasReproduction: boolean;
	generatedCodeRisk: boolean;
	needsRepositoryMapping?: boolean;
	needsDifficultDiagnosis?: boolean;
	needsArchitectureAdvice?: boolean;
}

/** Non-secret capability evidence supplied by the native runtime. */
export interface CouncilMetadata {
	supported: boolean;
	modelLanes: readonly string[];
}

export type CouncilLane = "native-sol" | "native-luna" | "native-terra";
export type CouncilAdviser = "native-sol-adviser" | "native-luna-adviser" | "native-terra-adviser";
export type SupportingAgent = "omcs_explorer" | "omcs_librarian" | "omcs_oracle";

export interface PolicyInput {
	profile: ExecutionProfile;
	risk: WorkSignals;
	councilMetadata?: CouncilMetadata;
}

export type PolicySkill =
	| "context"
	| "codebase-design"
	| "research"
	| "plan"
	| "tdd"
	| "ai-slop-cleaner"
	| "verification"
	| "code-review";

export interface CouncilOverlay {
	status: "disabled" | "unavailable" | "enabled";
	explicit: boolean;
	advisers: CouncilAdviser[];
	nativeLanes: CouncilLane[];
}

export interface RiskEvidence {
	blastRadius: BlastRadius;
	unsettled: boolean;
	reviewRequired: boolean;
	visual: boolean;
	research: boolean;
	generatedCode: boolean;
}

export interface AntiSlopGate {
	enabled: boolean;
	scope: "changed-files";
	beforeReview: true;
	invalidatesVerificationOnEdit: true;
}

export interface ExecutionPolicy {
	profile: ExecutionProfile;
	route: RouteDecision;
	council: CouncilOverlay;
	skills: PolicySkill[];
	risk: RiskEvidence;
	supportingAgents: SupportingAgent[];
	antiSlop: AntiSlopGate;
}

const COUNCIL_LANES: readonly CouncilLane[] = ["native-sol", "native-luna", "native-terra"];
const COUNCIL_ADVISERS: Record<CouncilLane, CouncilAdviser> = {
	"native-sol": "native-sol-adviser",
	"native-luna": "native-luna-adviser",
	"native-terra": "native-terra-adviser",
};

function provenCouncilLanes(metadata: CouncilMetadata | undefined): CouncilLane[] {
	if (!metadata?.supported) return [];
	const reported = new Set(metadata.modelLanes);
	const lanes = COUNCIL_LANES.filter((lane) => reported.has(lane));
	return lanes.length >= 2 ? [...lanes] : [];
}

function chooseRoute(profile: ExecutionProfile, risk: WorkSignals): RouteDecision {
	const routedRisk: RiskInput = {
		settled: risk.settled,
		blastRadius: risk.blastRadius,
		reviewRequired: profile === "thorough" || profile === "council" || risk.reviewRequired,
		visual: risk.visual,
		delegable: risk.delegable,
	};
	return selectRoute(routedRisk);
}

function addSkill(skills: PolicySkill[], skill: PolicySkill): void {
	if (!skills.includes(skill)) skills.push(skill);
}

function selectSkills(profile: ExecutionProfile, risk: WorkSignals, route: RouteDecision): PolicySkill[] {
	const skills: PolicySkill[] = [];
	const thorough = profile === "thorough" || profile === "council";

	if (thorough || !risk.settled) addSkill(skills, "context");
	if (thorough || !risk.settled || risk.blastRadius !== "narrow") addSkill(skills, "codebase-design");
	if (risk.needsResearch) addSkill(skills, "research");
	if (thorough || !risk.settled || risk.blastRadius !== "narrow") addSkill(skills, "plan");
	if (thorough || !risk.settled || risk.hasReproduction) addSkill(skills, "tdd");

	const antiSlop = thorough || route.mode === "audit" || route.mode === "full" || risk.generatedCodeRisk;
	if (antiSlop) addSkill(skills, "ai-slop-cleaner");
	addSkill(skills, "verification");
	if (thorough || route.mode === "audit" || route.mode === "full") addSkill(skills, "code-review");

	return skills;
}

function selectSupportingAgents(risk: WorkSignals): SupportingAgent[] {
	const agents: SupportingAgent[] = [];
	if (risk.needsRepositoryMapping) agents.push("omcs_explorer");
	if (risk.needsResearch) agents.push("omcs_librarian");
	if (risk.needsDifficultDiagnosis || risk.needsArchitectureAdvice) agents.push("omcs_oracle");
	return agents;
}

function riskEvidence(risk: WorkSignals): RiskEvidence {
	return {
		blastRadius: risk.blastRadius,
		unsettled: !risk.settled,
		reviewRequired: risk.reviewRequired,
		visual: risk.visual,
		research: risk.needsResearch,
		generatedCode: risk.generatedCodeRisk,
	};
}

/** Maps a resolved profile and observed work signals to visible, fail-closed execution gates. */
export function selectExecutionPolicy(input: PolicyInput): ExecutionPolicy {
	const route = chooseRoute(input.profile, input.risk);
	const thorough = input.profile === "thorough" || input.profile === "council";
	const antiSlopEnabled = thorough || route.mode === "audit" || route.mode === "full" || input.risk.generatedCodeRisk;
	const councilLanes = input.profile === "council" ? provenCouncilLanes(input.councilMetadata) : [];
	const council: CouncilOverlay = input.profile !== "council"
		? { status: "disabled", explicit: false, advisers: [], nativeLanes: [] }
		: councilLanes.length === 0
			? { status: "unavailable", explicit: true, advisers: [], nativeLanes: [] }
			: {
				status: "enabled",
				explicit: true,
				advisers: councilLanes.map((lane) => COUNCIL_ADVISERS[lane]),
				nativeLanes: councilLanes,
			};

	return {
		profile: input.profile,
		route,
		council,
		skills: selectSkills(input.profile, input.risk, route),
		risk: riskEvidence(input.risk),
		supportingAgents: selectSupportingAgents(input.risk),
		antiSlop: {
			enabled: antiSlopEnabled,
			scope: "changed-files",
			beforeReview: true,
			invalidatesVerificationOnEdit: true,
		},
	};
}
