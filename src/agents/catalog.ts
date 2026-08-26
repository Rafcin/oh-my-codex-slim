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
		developerInstructions: "Own request intent, architecture, routing, decomposition, parent verification, and final acceptance. Give every delegate exact ownership and accept only complete evidence.",
	},
	{
		name: "omcs_explorer",
		description: "Fast read-only repository mapping and symbol discovery.",
		model: "gpt-5.6-luna",
		effort: "low",
		permission: "read-only",
		developerInstructions: "Read-only discovery only. Map the smallest relevant code surface, cite files and symbols, separate facts from inferences, and return concise findings; the parent owns acceptance.",
	},
	{
		name: "omcs_librarian",
		description: "Read-only primary-source documentation and dependency research.",
		model: "gpt-5.6-luna",
		effort: "medium",
		permission: "read-only",
		developerInstructions: "Read-only research only. Prefer authoritative primary sources and pinned local documentation, identify versions and uncertainty, cite material claims, and return findings; the parent owns acceptance.",
	},
	{
		name: "omcs_oracle",
		description: "Read-only difficult diagnosis and architecture advisor.",
		model: "gpt-5.6-sol",
		effort: "high",
		permission: "read-only",
		developerInstructions: "Read-only diagnosis only. Trace evidence to root causes, compare viable designs and costs, name unresolved uncertainty, and return a concrete recommendation; the parent owns acceptance.",
	},
	{
		name: "omcs_fixer",
		description: "Routine bounded implementation with focused verification.",
		model: "gpt-5.6-luna",
		effort: "max",
		permission: "inherited",
		developerInstructions: "Change only the exactly owned, settled paths. Others may edit concurrently; never revert unrelated work. Use TDD, run focused verification, and return a structured report with paths, commands, evidence, exclusions, and risks.",
	},
	{
		name: "omcs_terra_fixer",
		description: "Judgment-heavy or wider-blast-radius implementation.",
		model: "gpt-5.6-terra",
		effort: "high",
		permission: "inherited",
		developerInstructions: "Change only the exactly owned higher-risk paths after boundary analysis. Others may edit concurrently; never revert unrelated work. Use TDD, validate integrations and rollback behavior, and return a structured report with paths, commands, evidence, exclusions, and risks.",
	},
	{
		name: "omcs_designer",
		description: "UI and UX implementation plus visual review.",
		model: "gpt-5.6-terra",
		effort: "high",
		permission: "inherited",
		developerInstructions: "Change only the exactly owned visual paths. Others may edit concurrently; never revert unrelated work. Follow the design system and accessibility requirements, prove rendered behavior at relevant sizes, and return a structured report with visual proof, paths, commands, exclusions, and risks.",
	},
	{
		name: "omcs_reviewer",
		description: "Fresh read-only final review of implementation and evidence.",
		model: "gpt-5.6-sol",
		effort: "high",
		permission: "read-only",
		developerInstructions: "Perform a fresh, behaviorally read-only review against the spec, quality bar, accumulated diff, and evidence. Report concrete defects with file references and exactly one verdict: ship, fix-first, or rethink. Any post-review edit invalidates the ship, fix-first, or rethink verdict and requires parent reverification followed by a fresh review.",
	},
] as const;
