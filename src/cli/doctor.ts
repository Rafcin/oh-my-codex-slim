import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_CATALOG } from "../agents/catalog.js";
import {
	canonicalizeCodexHome,
	resolveCodexHome,
} from "../config/codex-home.js";
import { hasManagedConfigBlock } from "../config/generator.js";
import { readBoundedRegularFile } from "../config/safe-reader.js";
import { buildRouterEnvironment } from "../router/commands.js";
import type { RouterCapabilities } from "../router/types.js";
import { agentsLifecycle } from "./agents-lifecycle.js";
import { resolvePackagedOmcsMarketplace } from "./plugin-marketplace.js";
import { omcsPackageRoot } from "./package-root.js";
import { mcpHealthHandshake } from "./mcp-health.js";
import {
	readOmcsPluginRegistration,
	resolveTrustedCodexExecutable,
} from "./plugin-registration.js";

export interface DoctorCheck {
	name: string;
	ok: boolean;
	message: string;
}
export interface DoctorReport {
	ok: boolean;
	checks: DoctorCheck[];
	warnings: string[];
	errors: string[];
}
export interface DoctorOptions {
	codexHome?: string;
	nodeVersion?: string;
	packageRoot?: string;
}
export interface DoctorDependencies {
	codexVersion?: () => Promise<string | null>;
	mcpHandshake?: () => Promise<boolean>;
	routerCapabilities?: () => Promise<RouterCapabilities>;
	pluginRegistration?: () => Promise<boolean>;
}

function meetsNodeMinimum(version: string): boolean {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) return false;
	const [major, minor, patch] = match.slice(1).map(Number);
	return (
		major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0)))
	);
}

async function defaultCodexVersion(codexHome: string): Promise<string | null> {
	try {
		const executable = await resolveTrustedCodexExecutable();
		if (!executable) return null;
		const safeEnvironment = await buildRouterEnvironment();
		const result = await promisify(execFile)(executable, ["--version"], {
			timeout: 15_000,
			maxBuffer: 64 * 1024,
			env: {
				PATH: safeEnvironment.PATH,
				LANG: "C",
				LC_ALL: "C",
				CODEX_HOME: codexHome,
			},
		});
		return result.stdout.trim();
	} catch {
		return null;
	}
}

async function bounded<T>(
	operation: () => Promise<T>,
	milliseconds = 2_000,
): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			operation(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("bounded health check timed out")),
					milliseconds,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function push(
	checks: DoctorCheck[],
	name: string,
	ok: boolean,
	message: string,
): void {
	checks.push({ name, ok, message });
}

export async function doctor(
	options: DoctorOptions = {},
	dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];
	const warnings: string[] = [];
	const errors: string[] = [];
	const nodeVersion = options.nodeVersion ?? process.version;
	const nodeOkay = meetsNodeMinimum(nodeVersion);
	push(checks, "node", nodeOkay, nodeVersion);
	if (!nodeOkay) {
		errors.push(`Node.js >=22.19.0 is required (found ${nodeVersion}).`);
		return { ok: false, checks, warnings, errors };
	}

	const codexHome = await canonicalizeCodexHome(
		resolveCodexHome({ codexHome: options.codexHome }),
	);
	const codexVersion = await (
		dependencies.codexVersion ?? (() => defaultCodexVersion(codexHome))
	)();
	push(
		checks,
		"codex",
		Boolean(codexVersion),
		codexVersion ?? "Codex CLI was not found",
	);
	if (!codexVersion) errors.push("Codex CLI was not found.");

	const packageRoot = options.packageRoot ?? omcsPackageRoot();
	const marketplace = await resolvePackagedOmcsMarketplace(packageRoot);
	push(
		checks,
		"marketplace",
		Boolean(marketplace),
		marketplace?.marketplacePath ?? "Bundled marketplace is invalid or missing",
	);
	if (!marketplace)
		errors.push("Bundled OMCS marketplace is invalid or missing.");
	let pluginConfigured = false;
	try {
		pluginConfigured = await bounded(
			dependencies.pluginRegistration ??
				(() => readOmcsPluginRegistration({ codexHome })),
			20_000,
		);
	} catch {
		pluginConfigured = false;
	}
	const pluginOkay = Boolean(marketplace) && pluginConfigured;
	push(
		checks,
		"plugin",
		pluginOkay,
		pluginOkay
			? "Codex reports oh-my-codex-slim@omcs-local installed and enabled"
			: "Codex does not report oh-my-codex-slim@omcs-local installed and enabled",
	);
	if (!pluginOkay)
		errors.push(
			"The OMCS plugin must be installed and enabled through Codex CLI.",
		);

	let config = "";
	try {
		config =
			(
				await readBoundedRegularFile(join(codexHome, "config.toml"), {
					label: "Codex config",
				})
			)?.toString("utf8") ?? "";
	} catch {
		/* unhealthy read */
	}
	const configOkay = hasManagedConfigBlock(config);
	push(
		checks,
		"config",
		configOkay,
		configOkay
			? "OMCS managed config block is healthy"
			: "OMCS managed config block is missing",
	);
	if (!configOkay) errors.push("OMCS managed config block is missing.");

	const agents = await agentsLifecycle("check", { codexHome });
	push(
		checks,
		"agents",
		agents.healthy,
		`${agents.installed}/${AGENT_CATALOG.length} managed agents healthy`,
	);
	if (!agents.healthy)
		errors.push(
			`Expected ${AGENT_CATALOG.length} digest-matching OMCS agents; found ${agents.installed}.`,
		);

	let mcpOkay = false;
	try {
		mcpOkay = await bounded(dependencies.mcpHandshake ?? mcpHealthHandshake);
	} catch {
		mcpOkay = false;
	}
	push(
		checks,
		"mcp",
		mcpOkay,
		mcpOkay
			? "omcs_code_intel bounded handshake succeeded"
			: "omcs_code_intel bounded handshake failed",
	);
	if (!mcpOkay)
		errors.push("OMCS code-intelligence MCP bounded handshake failed.");

	const openCodexActive =
		/# Auto-injected by opencodex[\s\S]*?\bopenai_base_url\s*=/.test(config);
	push(
		checks,
		"opencodex",
		true,
		openCodexActive
			? "Supported OpenCodex routing is active"
			: "OpenCodex routing is inactive; native Codex routing remains available",
	);

	return { ok: errors.length === 0, checks, warnings, errors };
}
