import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, isAbsolute } from "node:path";

import type {
	CommandResult,
	RouterCommand,
	RouterProcessExecutor,
	RouterProcessOptions,
} from "./types.js";

export const ROUTER_COMMANDS = {
	version: ["codex-router", "version"],
	status: ["codex-router", "status"],
	doctor: ["codex-router", "doctor", "--json"],
	subagents: ["codex-router", "control", "subagents", "status"],
} as const satisfies Record<RouterCommand, readonly [string, ...string[]]>;

const ROUTER_TIMEOUT_MS = 15_000;
const ROUTER_DOCTOR_TIMEOUT_MS = 65_000;
const ROUTER_MAX_BUFFER = 256 * 1024;
const ROUTER_SYSTEM_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

const defaultExecutor: RouterProcessExecutor = (file, args, options) =>
	new Promise((resolve, reject) => {
		execFile(file, [...args], options, (error, stdout, stderr) => {
			if (error) {
				Object.assign(error, { stdout, stderr });
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});

const ROUTER_PATH_ENVIRONMENT_KEYS = [
	"HOME",
	"CODEX_HOME",
	"CODEX_ROUTER_STATE_DIR",
	"KIMI_CODEX_STATE_DIR",
	"MODEL_ROUTER_STATE_DIR",
	"MODEL_ROUTER_MULTI_AGENT_STATE",
	"MODEL_ROUTER_MULTI_AGENT_ALL",
	"MODEL_ROUTER_SUBAGENT_PROOFS",
	"MODEL_ROUTER_SUBAGENT_AUTO_POLICY",
	"MODEL_ROUTER_LAUNCH_AGENTS_DIR",
	"CODEX_ROUTER_LAUNCH_AGENTS_DIR",
] as const;

const ROUTER_PORT_ENVIRONMENT_KEYS = [
	"MODEL_ROUTER_GATEWAY_PORT",
	"CODEX_ROUTER_GATEWAY_PORT",
	"KIMI_GATEWAY_PORT",
	"MODEL_ROUTER_OAUTH_PORT",
	"CODEX_ROUTER_OAUTH_PORT",
	"KIMI_OAUTH_FORWARD_PORT",
	"MODEL_ROUTER_PORT",
	"CODEX_ROUTER_PORT",
	"KIMI_ROUTER_PORT",
	"MODEL_ROUTER_API_PORT",
	"CODEX_ROUTER_API_PORT",
	"KIMI_API_FORWARD_PORT",
	"MODEL_ROUTER_GROK_OAUTH_PORT",
	"MODEL_ROUTER_DEVIN_CLI_PORT",
] as const;

const ROUTER_HOST_ENVIRONMENT_KEYS = ["CODEX_ROUTER_HOST", "KIMI_ROUTER_HOST"] as const;

function validRouterPort(value: string | undefined): string | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const port = Number(value);
	return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? String(port) : undefined;
}

function validRouterHost(value: string | undefined): string | undefined {
	if (!value || value.length > 253) return undefined;
	if (isIP(value)) return value;
	const labels = value.split(".");
	if (
		labels.some(
			(label) =>
				label.length < 1 ||
				label.length > 63 ||
				!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
		)
	) {
		return undefined;
	}
	return value;
}

function minimalRouterEnvironment(
	source: NodeJS.ProcessEnv,
	runningNodeDirectory: string | undefined,
): NodeJS.ProcessEnv {
	const path = [runningNodeDirectory, ...ROUTER_SYSTEM_PATH.split(":")].filter(
		(directory): directory is string => Boolean(directory),
	);
	const environment: NodeJS.ProcessEnv = {
		LANG: "C",
		LC_ALL: "C",
		PATH: [...new Set(path)].join(":"),
	};
	for (const key of ROUTER_PATH_ENVIRONMENT_KEYS) {
		if (source[key]) environment[key] = source[key];
	}
	for (const key of ROUTER_PORT_ENVIRONMENT_KEYS) {
		const port = validRouterPort(source[key]);
		if (port) environment[key] = port;
	}
	for (const key of ROUTER_HOST_ENVIRONMENT_KEYS) {
		const host = validRouterHost(source[key]);
		if (host) environment[key] = host;
	}
	return environment;
}

export async function buildRouterEnvironment(
	source: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
	return minimalRouterEnvironment(source, await trustedRunningNodeDirectory());
}

async function trustedRunningNodeDirectory(): Promise<string | undefined> {
	if (!isAbsolute(process.execPath)) return undefined;
	try {
		const canonical = await realpath(process.execPath);
		if (!isAbsolute(canonical)) return undefined;
		const information = await lstat(canonical);
		if (!information.isFile() || information.isSymbolicLink()) return undefined;
		await access(canonical, constants.X_OK);
		if ((await realpath(canonical)) !== canonical) return undefined;
		const directory = dirname(canonical);
		return (await lstat(directory)).isDirectory() ? directory : undefined;
	} catch {
		return undefined;
	}
}

async function safeExplicitRouterExecutable(requested: string): Promise<string | undefined> {
	if (!isAbsolute(requested)) return undefined;
	try {
		const canonical = await realpath(requested);
		if (!isAbsolute(canonical)) return undefined;
		const information = await lstat(canonical);
		if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) {
			return undefined;
		}
		await access(canonical, constants.X_OK);
		return (await realpath(canonical)) === canonical ? canonical : undefined;
	} catch {
		return undefined;
	}
}

function bounded(value: string): string {
	return value.slice(0, ROUTER_MAX_BUFFER);
}

export function redactRouterCredentials(value: string): string {
	let redacted = bounded(value);
	const patterns: Array<[RegExp, string]> = [
		[/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED]"],
		[/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/gi, "[REDACTED]"],
		[/\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s,;]+/gi, "[REDACTED]"],
		[/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]"],
		[/--(?:api[-_]?key|token|secret|password|credential)(?:=|\s+)[^\s,;]+/gi, "[REDACTED]"],
		[/["']?(?:api[-_]?key|provider[-_]?(?:api[-_]?)?key|client[-_]?secret|consumer[-_]?secret|aws[-_]?secret[-_]?access[-_]?key|aws[-_]?session[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|auth[-_]?token|private[-_]?token|token|secret|password|credential)["']?\s*[:=]\s*["']?[^\s,"';}]+["']?/gi, "[REDACTED]"],
		[/\b(?:sk|xai|ghp|github_pat|AIza)[-_A-Za-z0-9]{8,}\b/g, "[REDACTED]"],
		[/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
	];
	for (const [pattern, replacement] of patterns) redacted = redacted.replace(pattern, replacement);
	return redacted;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code ?? "")
		: undefined;
}

function errorStderr(error: unknown): string {
	if (typeof error !== "object" || error === null || !("stderr" in error)) return "";
	const stderr = (error as { stderr?: unknown }).stderr;
	return typeof stderr === "string" || Buffer.isBuffer(stderr) ? String(stderr) : "";
}

function isTimeout(error: unknown): boolean {
	const code = errorCode(error);
	if (code === "ETIMEDOUT" || code === "ERR_CHILD_PROCESS_TIMEOUT") return true;
	return typeof error === "object" && error !== null && "killed" in error
		? (error as { killed?: unknown }).killed === true
		: false;
}

export interface RunRouterCommandOptions {
	execute?: RouterProcessExecutor;
	environment?: NodeJS.ProcessEnv;
	routerExecutable?: string;
}

export async function runRouterCommand(
	command: RouterCommand,
	options: RunRouterCommandOptions = {},
): Promise<CommandResult> {
	const [defaultFile, ...args] = ROUTER_COMMANDS[command];
	let file: string = defaultFile;
	if (options.routerExecutable !== undefined) {
		const explicitFile = await safeExplicitRouterExecutable(options.routerExecutable);
		if (!explicitFile) {
			return {
				ok: false,
				code: "router-command-failed",
				message: "Explicit Codex Router executable is unsafe or unavailable",
			};
		}
		file = explicitFile;
	}
	const processOptions: RouterProcessOptions = {
		timeout: command === "doctor" ? ROUTER_DOCTOR_TIMEOUT_MS : ROUTER_TIMEOUT_MS,
		maxBuffer: ROUTER_MAX_BUFFER,
		env: await buildRouterEnvironment(options.environment ?? process.env),
		encoding: "utf8",
		windowsHide: true,
	};
	try {
		const result = await (options.execute ?? defaultExecutor)(file, args, processOptions);
		return {
			ok: true,
			stdout: redactRouterCredentials(result.stdout),
			stderr: redactRouterCredentials(result.stderr),
		};
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			return { ok: false, code: "missing-router", message: "Codex Router is not installed" };
		}
		if (isTimeout(error)) {
			return {
				ok: false,
				code: "router-timeout",
				message: `Codex Router command timed out after ${command === "doctor" ? ROUTER_DOCTOR_TIMEOUT_MS : ROUTER_TIMEOUT_MS}ms`,
			};
		}
		if (errorCode(error) === "2") {
			return {
				ok: false,
				code: "unsupported-router-command",
				message: "Installed Codex Router does not support this command boundary",
			};
		}
		const stderr = redactRouterCredentials(errorStderr(error)).trim();
		return {
			ok: false,
			code: "router-command-failed",
			message: stderr ? `Codex Router command failed: ${stderr}` : "Codex Router command failed",
		};
	}
}
