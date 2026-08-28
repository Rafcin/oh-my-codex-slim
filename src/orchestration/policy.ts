import type { ExecutionProfile } from "../config/omcs-config.js";
import {
	selectRoute,
	type AuxiliaryAgent,
	type BlastRadius,
	type Consequence,
	type RouteDecision,
	type RouteFallback,
	type Uncertainty,
} from "./risk.js";

export type { RouteMode } from "./risk.js";

export interface WorkSignals {
	settled: boolean;
	blastRadius: BlastRadius;
	consequence: Consequence;
	uncertainty: Uncertainty;
	delegationValue: boolean;
	visual: boolean;
	needsResearch: boolean;
	behaviorChange: boolean;
	hasReproduction: boolean;
	concreteSlopFinding: boolean;
	needsRepositoryMapping?: boolean;
	needsDifficultDiagnosis?: boolean;
	needsArchitectureAdvice?: boolean;
}

/** Non-secret capability evidence for only the auxiliary roles selected by policy. */
export interface CapabilityMetadata {
	checked: readonly AuxiliaryAgent[];
	available: readonly AuxiliaryAgent[];
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
	capabilities?: CapabilityMetadata;
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
	consequence: Consequence;
	uncertainty: Uncertainty;
	unsettled: boolean;
	visual: boolean;
	research: boolean;
	concreteSlopFinding: boolean;
}

export interface AntiSlopGate {
	enabled: boolean;
	scope: "changed-files";
	beforeReview: true;
	invalidatesVerificationOnEdit: true;
}

export interface ExecutionBudget {
	maxAuxiliaries: 1 | 2;
	oneFinalVerificationPath: true;
	repeatVerificationOnlyAfterInputChange: true;
	postGreenEdits: "named-finding-only";
}

export interface CapabilityEvidence {
	checked: AuxiliaryAgent[];
	available: AuxiliaryAgent[];
	fallback: RouteFallback | null;
}

export interface ExecutionPolicy {
	profile: ExecutionProfile;
	route: RouteDecision;
	council: CouncilOverlay;
	skills: PolicySkill[];
	risk: RiskEvidence;
	supportingAgents: SupportingAgent[];
	antiSlop: AntiSlopGate;
	budget: ExecutionBudget;
	capabilities: CapabilityEvidence;
}

export class MissingRequiredCapabilityError extends Error {
	readonly capability: "omcs_reviewer";

	constructor(capability: "omcs_reviewer") {
		super(`OMCS requires unavailable capability: ${capability}`);
		this.name = "MissingRequiredCapabilityError";
		this.capability = capability;
	}
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

function executionBudget(profile: ExecutionProfile): ExecutionBudget {
	return {
		maxAuxiliaries: profile === "thorough" || profile === "council" ? 2 : 1,
		oneFinalVerificationPath: true,
		repeatVerificationOnlyAfterInputChange: true,
		postGreenEdits: "named-finding-only",
	};
}

function chooseRoute(profile: ExecutionProfile, risk: WorkSignals, budget: ExecutionBudget): RouteDecision {
	return selectRoute({
		settled: risk.settled,
		blastRadius: risk.blastRadius,
		consequence: risk.consequence,
		uncertainty: risk.uncertainty,
		delegationValue: risk.delegationValue,
		visual: risk.visual,
		forceReview: profile === "thorough" || profile === "council",
		maxAuxiliaries: budget.maxAuxiliaries,
	});
}

function reconcileCapabilities(route: RouteDecision, supportingAgents: SupportingAgent[], metadata: CapabilityMetadata | undefined): {
	route: RouteDecision;
	supportingAgents: SupportingAgent[];
	evidence: CapabilityEvidence;
} {
	const checked = [...(metadata?.checked ?? [])];
	const available = [...(metadata?.available ?? [])];
	const selected = [route.implementer, route.reviewer, ...supportingAgents].filter((agent): agent is AuxiliaryAgent => agent !== undefined);
	if (new Set(checked).size !== checked.length || new Set(available).size !== available.length || available.some((agent) => !checked.includes(agent)) || checked.some((agent) => !selected.includes(agent))) {
		throw new Error("OMCS capability evidence is invalid");
	}

	if (route.reviewer && checked.includes(route.reviewer) && !available.includes(route.reviewer)) {
		throw new MissingRequiredCapabilityError(route.reviewer);
	}

	if (route.implementer && checked.includes(route.implementer) && !available.includes(route.implementer)) {
		const fallback: RouteFallback = {
			unavailable: route.implementer,
			from: route.mode as "delegate" | "full",
			reason: "optional-capability-unavailable",
		};
		return {
			route: route.reviewer
				? { mode: "audit", reviewer: route.reviewer, fallback }
				: { mode: "solo", fallback },
			supportingAgents,
			evidence: { checked, available, fallback },
		};
	}

	const unavailableSupport = supportingAgents.find((agent) => checked.includes(agent) && !available.includes(agent));
	if (unavailableSupport) {
		const fallback: RouteFallback = {
			unavailable: unavailableSupport,
			from: "support",
			reason: "optional-capability-unavailable",
		};
		return {
			route: { ...route, fallback },
			supportingAgents: [],
			evidence: { checked, available, fallback },
		};
	}

	return { route, supportingAgents, evidence: { checked, available, fallback: null } };
}

function addSkill(skills: PolicySkill[], skill: PolicySkill): void {
	if (!skills.includes(skill)) skills.push(skill);
}

function selectSkills(profile: ExecutionProfile, risk: WorkSignals, route: RouteDecision): PolicySkill[] {
	const skills: PolicySkill[] = [];
	const thorough = profile === "thorough" || profile === "council";

	if (!risk.settled || risk.uncertainty === "material") addSkill(skills, "context");
	if (thorough || risk.needsArchitectureAdvice || risk.blastRadius === "wide") addSkill(skills, "codebase-design");
	if (risk.needsResearch) addSkill(skills, "research");
	if (thorough || risk.consequence === "material" || risk.uncertainty === "material" || route.mode === "delegate" || route.mode === "full") addSkill(skills, "plan");
	if (thorough || risk.behaviorChange || risk.hasReproduction) addSkill(skills, "tdd");
	if (risk.concreteSlopFinding) addSkill(skills, "ai-slop-cleaner");
	addSkill(skills, "verification");
	if (route.mode === "audit" || route.mode === "full") addSkill(skills, "code-review");

	return skills;
}

function routeAuxiliaries(route: RouteDecision): number {
	return Number(route.implementer !== undefined) + Number(route.reviewer !== undefined);
}

function selectSupportingAgents(risk: WorkSignals, route: RouteDecision, budget: ExecutionBudget): SupportingAgent[] {
	if (routeAuxiliaries(route) >= budget.maxAuxiliaries) return [];
	if (risk.needsRepositoryMapping) return ["omcs_explorer"];
	if (risk.needsResearch) return ["omcs_librarian"];
	if (risk.needsDifficultDiagnosis || risk.needsArchitectureAdvice) return ["omcs_oracle"];
	return [];
}

function riskEvidence(risk: WorkSignals): RiskEvidence {
	return {
		blastRadius: risk.blastRadius,
		consequence: risk.consequence,
		uncertainty: risk.uncertainty,
		unsettled: !risk.settled,
		visual: risk.visual,
		research: risk.needsResearch,
		concreteSlopFinding: risk.concreteSlopFinding,
	};
}

/** Maps a resolved profile and observed work signals to visible, fail-closed execution gates. */
export function selectExecutionPolicy(input: PolicyInput): ExecutionPolicy {
	const budget = executionBudget(input.profile);
	const initialRoute = chooseRoute(input.profile, input.risk, budget);
	const selectedSupport = selectSupportingAgents(input.risk, initialRoute, budget);
	const reconciled = reconcileCapabilities(initialRoute, selectedSupport, input.capabilities);
	const route = reconciled.route;
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
		supportingAgents: reconciled.supportingAgents,
		antiSlop: {
			enabled: input.risk.concreteSlopFinding,
			scope: "changed-files",
			beforeReview: true,
			invalidatesVerificationOnEdit: true,
		},
		budget,
		capabilities: reconciled.evidence,
	};
}
