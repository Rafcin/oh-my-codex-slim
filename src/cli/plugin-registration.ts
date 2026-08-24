import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { buildRouterEnvironment } from "../router/commands.js";
import { OMCS_LOCAL_MARKETPLACE_NAME, OMCS_LOCAL_PLUGIN_CONFIG_KEY, OMCS_PLUGIN_NAME } from "./plugin-marketplace.js";

interface CodexPluginProcessOptions {
	env: NodeJS.ProcessEnv;
	timeout: number;
	maxBuffer: number;
	encoding: BufferEncoding;
}

export type CodexPluginProcessExecutor = (
	file: string,
	args: readonly string[],
	options: CodexPluginProcessOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface CodexPluginRegistrationOptions {
	codexHome: string;
	codexExecutable?: string;
	environment?: NodeJS.ProcessEnv;
	execute?: CodexPluginProcessExecutor;
}

export interface ResolveTrustedCodexExecutableOptions {
	homeDirectory?: string;
	runningNodeExecutable?: string;
	systemCandidates?: readonly string[];
}

const SYSTEM_CODEX_CANDIDATES = [
	"/opt/homebrew/bin/codex",
	"/usr/local/bin/codex",
	"/usr/bin/codex",
	"/bin/codex",
] as const;

async function safeCodexExecutable(candidate: string): Promise<string | null> {
	if (!isAbsolute(candidate)) return null;
	try {
		const canonical = await realpath(candidate);
		if (!isAbsolute(canonical)) return null;
		const information = await lstat(canonical);
		if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) return null;
		await access(canonical, constants.X_OK);
		return (await realpath(canonical)) === canonical ? canonical : null;
	} catch {
		return null;
	}
}

/** Resolves only known Codex installation locations and returns the validated canonical target. */
export async function resolveTrustedCodexExecutable(
	options: ResolveTrustedCodexExecutableOptions = {},
): Promise<string | null> {
	const home = options.homeDirectory ?? homedir();
	const nodeExecutable = options.runningNodeExecutable ?? process.execPath;
	const candidates = [
		join(dirname(nodeExecutable), "codex"),
		join(home, ".bun", "bin", "codex"),
		join(home, ".local", "bin", "codex"),
		join(home, ".npm-global", "bin", "codex"),
		join(home, ".volta", "bin", "codex"),
		join(home, ".asdf", "shims", "codex"),
		...(options.systemCandidates ?? SYSTEM_CODEX_CANDIDATES),
	];
	for (const candidate of candidates) {
		const safe = await safeCodexExecutable(candidate);
		if (safe) return safe;
	}
	return null;
}

const installedPluginSchema = z.object({
	pluginId: z.string(),
	name: z.string(),
	marketplaceName: z.string(),
	version: z.string(),
	installed: z.boolean(),
	enabled: z.boolean(),
}).passthrough();

const pluginListSchema = z.object({
	installed: z.array(installedPluginSchema),
	available: z.array(z.unknown()),
}).strict();

const defaultExecutor: CodexPluginProcessExecutor = (file, args, options) => new Promise((resolve, reject) => {
	execFile(file, [...args], options, (error, stdout, stderr) => {
		if (error) { reject(error); return; }
		resolve({ stdout, stderr });
	});
});

/** Proves OMCS installation through Codex's exact bounded read-only JSON boundary. */
export async function readOmcsPluginRegistration(options: CodexPluginRegistrationOptions): Promise<boolean> {
	const executable = options.codexExecutable === undefined
		? await resolveTrustedCodexExecutable()
		: await safeCodexExecutable(options.codexExecutable);
	if (!executable) throw new Error("Codex executable is unavailable or unsafe");
	const safe = await buildRouterEnvironment(options.environment ?? process.env);
	const environment: NodeJS.ProcessEnv = {
		PATH: safe.PATH,
		LANG: "C",
		LC_ALL: "C",
		CODEX_HOME: options.codexHome,
	};
	let stdout: string;
	try {
		({ stdout } = await (options.execute ?? defaultExecutor)(executable, ["plugin", "list", "--json"], {
			env: environment,
			timeout: 15_000,
			maxBuffer: 256 * 1024,
			encoding: "utf8",
		}));
	} catch {
		throw new Error("Codex plugin registration check failed safely");
	}
	let document: z.infer<typeof pluginListSchema>;
	try {
		if (Buffer.byteLength(stdout) > 256 * 1024) throw new Error("oversized");
		document = pluginListSchema.parse(JSON.parse(stdout));
	} catch {
		throw new Error("Incompatible Codex plugin list output");
	}
	return document.installed.some((plugin) => plugin.pluginId === OMCS_LOCAL_PLUGIN_CONFIG_KEY
		&& plugin.name === OMCS_PLUGIN_NAME
		&& plugin.marketplaceName === OMCS_LOCAL_MARKETPLACE_NAME
		&& plugin.installed === true
		&& plugin.enabled === true);
}
