/** The only delivery routes. Council is handled as an advisory policy overlay. */
export type RouteMode = "solo" | "delegate" | "audit" | "full";
export type BlastRadius = "narrow" | "moderate" | "wide";
export type Consequence = "low" | "material";
export type Uncertainty = "low" | "material";
export type Implementer = "omcs_fixer" | "omcs_terra_fixer" | "omcs_designer";
export type Reviewer = "omcs_reviewer";
export type AuxiliaryAgent = Implementer | Reviewer | "omcs_explorer" | "omcs_librarian" | "omcs_oracle";

export interface RouteFallback {
	unavailable: Exclude<AuxiliaryAgent, Reviewer>;
	from: "delegate" | "full" | "support";
	reason: "optional-capability-unavailable";
}

export interface RiskInput {
	settled: boolean;
	blastRadius: BlastRadius;
	consequence: Consequence;
	uncertainty: Uncertainty;
	delegationValue: boolean;
	visual?: boolean;
	forceReview?: boolean;
	maxAuxiliaries?: 1 | 2;
}

export interface RouteDecision {
	mode: RouteMode;
	implementer?: Implementer;
	reviewer?: Reviewer;
	fallback?: RouteFallback;
}

function needsIndependentReview(input: RiskInput): boolean {
	return input.forceReview === true
		|| (input.consequence === "material" && (input.uncertainty === "material" || input.blastRadius === "wide"));
}

function chooseImplementer(input: RiskInput): Implementer {
	if (input.visual) return "omcs_designer";
	return input.blastRadius === "wide" ? "omcs_terra_fixer" : "omcs_fixer";
}

/** Selects the smallest delivery route that satisfies consequence, uncertainty, and budget. */
export function selectRoute(input: RiskInput): RouteDecision {
	const review = needsIndependentReview(input);
	const canDelegate = input.settled && input.uncertainty === "low" && input.delegationValue;
	const maxAuxiliaries = input.maxAuxiliaries ?? 1;

	if (review) {
		if (canDelegate && maxAuxiliaries >= 2) {
			return { mode: "full", implementer: chooseImplementer(input), reviewer: "omcs_reviewer" };
		}
		return { mode: "audit", reviewer: "omcs_reviewer" };
	}

	if (!canDelegate) return { mode: "solo" };
	return { mode: "delegate", implementer: chooseImplementer(input) };
}
