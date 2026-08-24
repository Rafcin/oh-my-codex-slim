import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeCodexHome, isOmcsManagedRelativePath, resolveCodexHome } from "../config/codex-home.js";
import {
	managedFileDigest,
	planManagedFileWrite,
	readManagedFile,
	readManagedFilesManifest,
	writeManagedFiles,
	type ManagedFilesDependencies,
} from "../config/managed-files.js";
import { mergeConfig, OMCS_LIFECYCLE_MARKER } from "../config/generator.js";
import { agentManagedFileWrites, managedConflictPaths } from "../agents/install.js";

export interface SetupOptions {
	codexHome?: string;
	dryRun?: boolean;
	scope?: "user" | "project";
	projectRoot?: string;
	packageRoot?: string;
	now?: () => Date;
}

export interface SetupReport {
	changed: string[];
	unchanged: string[];
	conflicts: string[];
	backups: string[];
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as { code?: unknown }).code === "ENOENT";
}

function selectedCodexHome(options: SetupOptions): string {
	if (options.codexHome) return resolveCodexHome({ codexHome: options.codexHome });
	if (options.scope === "project") return join(options.projectRoot ?? process.cwd(), ".codex");
	return resolveCodexHome();
}

async function reservedAgentConflicts(codexHome: string): Promise<string[]> {
	const agentsDirectory = join(codexHome, "agents");
	try {
		const stat = await lstat(agentsDirectory);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`OMCS agents directory is unsafe: ${agentsDirectory}`);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
	const manifest = await readManagedFilesManifest(codexHome);
	const conflicts: string[] = [];
	const entries = await readdir(agentsDirectory, { withFileTypes: true });
	for (const entry of entries) {
		const relativePath = `agents/${entry.name}`;
		if (!isOmcsManagedRelativePath(relativePath)) continue;
		if (entry.isSymbolicLink() || !entry.isFile()) {
			conflicts.push(relativePath);
			continue;
		}
		const current = await readManagedFile(codexHome, relativePath);
		const record = manifest.files.find((candidate) => candidate.path === relativePath);
		if (!current || !record || managedFileDigest(current) !== record.sha256) conflicts.push(relativePath);
	}
	return conflicts.sort();
}

/**
 * Creates a comment-only lifecycle marker. Codex CLI owns marketplace
 * registration; OMCS owns only the marker block and reserved agent files.
 */
export async function setup(
	options: SetupOptions = {},
	dependencies: ManagedFilesDependencies = {},
): Promise<SetupReport> {
	const codexHome = await canonicalizeCodexHome(selectedCodexHome(options));
	const reservedConflicts = await reservedAgentConflicts(codexHome);

	const currentConfig = await readManagedFile(codexHome, "config.toml");
	const desiredConfig = Buffer.from(mergeConfig(currentConfig?.toString("utf8") ?? "", OMCS_LIFECYCLE_MARKER));
	const installedAt = (options.now ?? (() => new Date()))().toISOString();
	let configConflicts: string[] = [];
	try {
		await planManagedFileWrite(join(codexHome, "config.toml"), desiredConfig, {
			codexHome,
			sourceVersion: "0.1.0",
			installedAt,
		});
	} catch (error) {
		configConflicts = managedConflictPaths(error);
		if (configConflicts.length === 0) throw error;
	}
	const preflightConflicts = [...new Set([...reservedConflicts, ...configConflicts])].sort();
	if (preflightConflicts.length > 0) {
		return { changed: [], unchanged: [], conflicts: preflightConflicts, backups: [] };
	}
	let plans;
	try {
		plans = await writeManagedFiles([
			{ path: join(codexHome, "config.toml"), bytes: desiredConfig },
			...agentManagedFileWrites(codexHome),
		], {
			codexHome,
			sourceVersion: "0.1.0",
			installedAt,
			dryRun: options.dryRun,
		}, dependencies);
	} catch (error) {
		const conflicts = managedConflictPaths(error);
		if (conflicts.length > 0) return { changed: [], unchanged: [], conflicts, backups: [] };
		throw error;
	}
	const report: SetupReport = {
		changed: plans.filter((plan) => plan.changed).map((plan) => plan.relativePath),
		unchanged: plans.filter((plan) => !plan.changed).map((plan) => plan.relativePath),
		conflicts: [],
		backups: plans.flatMap((plan) => plan.backup ? [plan.backup] : []),
	};
	return report;
}
