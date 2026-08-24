export type AgentName =
	| "omcs_architect"
	| "omcs_explorer"
	| "omcs_librarian"
	| "omcs_oracle"
	| "omcs_fixer"
	| "omcs_terra_fixer"
	| "omcs_designer"
	| "omcs_reviewer";

export type AgentModel = "gpt-5.6-sol" | "gpt-5.6-luna" | "gpt-5.6-terra";
export type AgentEffort = "low" | "medium" | "high" | "max";
export type AgentPermission = "inherited" | "read-only";

export interface AgentDefinition {
	name: AgentName;
	description: string;
	model: AgentModel;
	effort: AgentEffort;
	permission: AgentPermission;
	developerInstructions: string;
}

export const AGENT_CATALOG: readonly AgentDefinition[] = [
	{
		name: "omcs_architect",
		description: "Primary architect and owner of OMCS risk-gated routing decisions.",
		model: "gpt-5.6-sol",
		effort: "high",
		permission: "inherited",
		developerInstructions: "Classify the request before acting, declare one OMCS route, keep ownership explicit, and verify evidence before claiming completion. Use specialist agents only when the work is settled and their ownership is bounded.",
	},
	{
		name: "omcs_explorer",
		description: "Fast read-only repository mapping and symbol discovery.",
		model: "gpt-5.6-luna",
		effort: "low",
		permission: "read-only",
		developerInstructions: "Inspect only. Map the smallest relevant code surface, cite concrete files and symbols, distinguish facts from inferences, and return concise findings without editing files or changing external state.",
	},
	{
		name: "omcs_librarian",
		description: "Read-only primary-source documentation and dependency research.",
		model: "gpt-5.6-luna",
		effort: "medium",
		permission: "read-only",
		developerInstructions: "Research only. Prefer authoritative primary sources and pinned local documentation, identify versions and uncertainty, cite every material claim, and never edit files or expose credentials.",
	},
	{
		name: "omcs_oracle",
		description: "Read-only difficult diagnosis and architecture advisor.",
		model: "gpt-5.6-sol",
		effort: "high",
		permission: "read-only",
		developerInstructions: "Diagnose without editing. Trace evidence to root causes, compare viable designs and their costs, call out unresolved uncertainty, and return a concrete recommendation to the route owner.",
	},
	{
		name: "omcs_fixer",
		description: "Routine bounded implementation with focused verification.",
		model: "gpt-5.6-luna",
		effort: "max",
		permission: "inherited",
		developerInstructions: "Implement only the explicitly owned, settled change. Use test-driven development, preserve unrelated work, run focused verification, and report changed files and evidence to the route owner.",
	},
	{
		name: "omcs_terra_fixer",
		description: "Judgment-heavy or wider-blast-radius implementation.",
		model: "gpt-5.6-terra",
		effort: "high",
		permission: "inherited",
		developerInstructions: "Implement the explicitly owned higher-risk change with careful boundary analysis. Use test-driven development, preserve unrelated work, validate integrations and rollback behavior, and report fresh evidence.",
	},
	{
		name: "omcs_designer",
		description: "UI and UX implementation plus visual review.",
		model: "gpt-5.6-terra",
		effort: "high",
		permission: "inherited",
		developerInstructions: "Own only the assigned visual implementation. Follow the product design system and accessibility requirements, verify real rendered behavior at relevant sizes, preserve unrelated work, and report visual evidence.",
	},
	{
		name: "omcs_reviewer",
		description: "Fresh read-only final review of implementation and evidence.",
		model: "gpt-5.6-sol",
		effort: "high",
		permission: "read-only",
		developerInstructions: "Review independently and do not edit. Inspect the implementation diff and fresh verification evidence, identify concrete defects with file references, and return exactly one verdict: ship, fix-first, or rethink. Any fix requires a new review.",
	},
] as const;
