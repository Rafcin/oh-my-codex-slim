import { join } from "node:path";
import TOML from "@iarna/toml";
import { canonicalizeCodexHome, resolveCodexHome } from "../config/codex-home.js";
import {
	writeManagedFiles,
	ManagedOwnershipConflictsError,
	type ManagedFileWriteRequest,
	type ManagedFilesDependencies,
} from "../config/managed-files.js";
import { AGENT_CATALOG, type AgentDefinition } from "./catalog.js";

export interface AgentInstallOptions {
	codexHome?: string;
	dryRun?: boolean;
	now?: () => Date;
	sourceVersion?: string;
}

export interface AgentInstallReport {
	changed: string[];
	unchanged: string[];
	conflicts: string[];
	backups: string[];
}

export function agentRelativePath(agent: AgentDefinition): string {
	return `agents/${agent.name.replaceAll("_", "-")}.toml`;
}

export function renderAgentToml(agent: AgentDefinition): string {
	const document: Record<string, string> = {
		name: agent.name,
		description: agent.description,
		model: agent.model,
		model_reasoning_effort: agent.effort,
		developer_instructions: agent.developerInstructions,
	};
	if (agent.permission === "read-only") document.sandbox_mode = "read-only";
	return TOML.stringify(document);
}

export function agentManagedFileWrites(codexHome: string): ManagedFileWriteRequest[] {
	return AGENT_CATALOG.map((agent) => ({
		path: join(codexHome, agentRelativePath(agent)),
		bytes: Buffer.from(renderAgentToml(agent)),
	})).sort((left, right) => left.path.localeCompare(right.path));
}

export function managedConflictPaths(error: unknown): string[] {
	if (error instanceof ManagedOwnershipConflictsError) return [...error.paths];
	if (!(error instanceof Error)) return [];
	const match = /ownership conflict:\s+([^\s]+)/i.exec(error.message);
	return match?.[1] ? [match[1]] : [];
}

/**
 * Installs only the eight catalog-owned agent files through the managed-file
 * transaction boundary. Every path is planned before any write occurs.
 */
export async function installAgentCatalog(
	options: AgentInstallOptions = {},
	dependencies: ManagedFilesDependencies = {},
): Promise<AgentInstallReport> {
	const codexHome = await canonicalizeCodexHome(resolveCodexHome({ codexHome: options.codexHome }));
	const installedAt = (options.now ?? (() => new Date()))().toISOString();
	const sourceVersion = options.sourceVersion ?? "0.1.0";
	try {
		const plans = await writeManagedFiles(agentManagedFileWrites(codexHome), {
			codexHome,
			sourceVersion,
			installedAt,
			dryRun: options.dryRun,
		}, dependencies);
		return {
			changed: plans.filter((plan) => plan.changed).map((plan) => plan.relativePath),
			unchanged: plans.filter((plan) => !plan.changed).map((plan) => plan.relativePath),
			conflicts: [],
			backups: plans.flatMap((plan) => plan.backup ? [plan.backup] : []),
		};
	} catch (error) {
		const paths = managedConflictPaths(error);
		if (paths.length === 0) throw error;
		return { changed: [], unchanged: [], conflicts: paths, backups: [] };
	}
}
