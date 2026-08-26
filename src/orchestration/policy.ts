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
}

/** Non-secret capability evidence supplied by the native runtime. */
export interface CouncilMetadata {
	supported: boolean;
	modelLanes: readonly string[];
}

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
	enabled: boolean;
	explicit: boolean;
	implementer: null;
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
	risk: string;
	antiSlop: AntiSlopGate;
}

const SUPPORTED_COUNCIL_LANES = new Set(["native-sol", "native-luna", "native-terra"]);

function hasProvenCouncilDiversity(metadata: CouncilMetadata | undefined): boolean {
	if (!metadata?.supported) return false;
	const lanes = new Set(metadata.modelLanes.filter((lane) => SUPPORTED_COUNCIL_LANES.has(lane)));
	return lanes.size >= 2;
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

function describeRisk(risk: WorkSignals): string {
	const reasons: string[] = [];
	if (!risk.settled) reasons.push("unsettled scope");
	reasons.push(`${risk.blastRadius} blast radius`);
	if (risk.reviewRequired) reasons.push("review required");
	if (risk.visual) reasons.push("visual change");
	if (risk.needsResearch) reasons.push("research required");
	if (risk.generatedCodeRisk) reasons.push("generated-code risk");
	return reasons.join("; ");
}

/** Maps a resolved profile and observed work signals to visible, fail-closed execution gates. */
export function selectExecutionPolicy(input: PolicyInput): ExecutionPolicy {
	const route = chooseRoute(input.profile, input.risk);
	const thorough = input.profile === "thorough" || input.profile === "council";
	const antiSlopEnabled = thorough || route.mode === "audit" || route.mode === "full" || input.risk.generatedCodeRisk;

	return {
		profile: input.profile,
		route,
		council: {
			enabled: input.profile === "council" && hasProvenCouncilDiversity(input.councilMetadata),
			explicit: input.profile === "council",
			implementer: null,
		},
		skills: selectSkills(input.profile, input.risk, route),
		risk: describeRisk(input.risk),
		antiSlop: {
			enabled: antiSlopEnabled,
			scope: "changed-files",
			beforeReview: true,
			invalidatesVerificationOnEdit: true,
		},
	};
}
