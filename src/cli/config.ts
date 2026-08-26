import { join, resolve } from "node:path";

import {
	DEFAULT_OMCS_CONFIG,
	type ExecutionProfile,
	findProjectRoot,
	parseOmcsConfig,
	resolveOmcsConfig,
} from "../config/omcs-config.js";
import { type WriteOmcsConfigReport, writeOmcsConfig } from "../config/project-config.js";
import { readBoundedRegularFile } from "../config/safe-reader.js";
import { resolveCodexHome } from "../config/codex-home.js";

export interface ConfigureOmcsOptions {
	scope: "project" | "global" | "session";
	profile: ExecutionProfile;
	update?: boolean;
	dryRun?: boolean;
	cwd?: string;
	codexHome?: string;
}

export interface ShowEffectiveConfigOptions {
	cwd?: string;
	codexHome?: string;
}

function completeConfig(profile: ExecutionProfile) {
	return { ...DEFAULT_OMCS_CONFIG, profile };
}

function writeReport(scope: "project" | "global", report: WriteOmcsConfigReport, profile: ExecutionProfile) {
	return { scope, ...report, effectiveProfile: profile };
}

/** Configures only an explicit disk scope, or returns a non-persistent session overlay. */
export async function configureOmcs(options: ConfigureOmcsOptions): Promise<
	| ReturnType<typeof writeReport>
	| { scope: "session"; action: "session"; effectiveProfile: ExecutionProfile }
> {
	const cwd = resolve(options.cwd ?? process.cwd());
	if (options.scope === "session") {
		if (options.update) throw new Error("OMCS session configuration cannot write to disk");
		return { scope: "session", action: "session", effectiveProfile: options.profile };
	}
	const codexHome = resolveCodexHome({ codexHome: options.codexHome });
	let path: string;
	if (options.scope === "global") {
		path = join(codexHome, "oh-my-codex-slim", "config.json");
	} else {
		const root = await findProjectRoot(cwd);
		if (!root) throw new Error("OMCS project configuration requires a Git root");
		path = join(root, "omcs.config.json");
	}
	const report = await writeOmcsConfig({
		path,
		config: completeConfig(options.profile),
		update: options.update ?? false,
		dryRun: options.dryRun ?? false,
	});
	return writeReport(options.scope, report, options.profile);
}

/** Shows only public effective identity and provenance, never hidden configuration content. */
export async function showEffectiveConfig(options: ShowEffectiveConfigOptions = {}): Promise<{
	effectiveProfile: ExecutionProfile;
	sources: Awaited<ReturnType<typeof resolveOmcsConfig>>["sources"];
}> {
	const resolved = await resolveOmcsConfig({
		cwd: resolve(options.cwd ?? process.cwd()),
		codexHome: resolveCodexHome({ codexHome: options.codexHome }),
	});
	return { effectiveProfile: resolved.effective.profile, sources: resolved.sources };
}

/** Validates one bounded regular config file and returns its public execution profile. */
export async function validateOmcsConfigFile(path: string): Promise<{
	path: string;
	valid: true;
	profile: ExecutionProfile;
}> {
	const resolved = resolve(path);
	const bytes = await readBoundedRegularFile(resolved, { maxBytes: 64 * 1024, label: "configuration" });
	if (!bytes) throw new Error("OMCS configuration file does not exist");
	const config = parseOmcsConfig(bytes, "configuration");
	return { path: resolved, valid: true, profile: config.profile ?? DEFAULT_OMCS_CONFIG.profile };
}
