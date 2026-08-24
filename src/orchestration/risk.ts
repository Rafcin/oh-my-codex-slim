export type RouteMode = "solo" | "delegate" | "audit" | "full" | "council";
export type BlastRadius = "narrow" | "moderate" | "wide";

export interface RiskInput {
	settled: boolean;
	blastRadius: BlastRadius;
	reviewRequired: boolean;
	visual?: boolean;
	councilRequested?: boolean;
	delegable?: boolean;
}

export interface RouteDecision {
	mode: RouteMode;
	implementer?: "omcs_fixer" | "omcs_terra_fixer" | "omcs_designer";
	reviewer?: "omcs_reviewer";
}

export function selectRoute(input: RiskInput): RouteDecision {
	if (input.councilRequested) return { mode: "council" };
	if (!input.settled) return { mode: "solo" };
	if (input.delegable === false) {
		return input.reviewRequired ? { mode: "audit", reviewer: "omcs_reviewer" } : { mode: "solo" };
	}
	const implementer = input.visual
		? "omcs_designer"
		: input.blastRadius === "wide"
			? "omcs_terra_fixer"
			: "omcs_fixer";
	return input.reviewRequired
		? { mode: "full", implementer, reviewer: "omcs_reviewer" }
		: { mode: "delegate", implementer };
}
