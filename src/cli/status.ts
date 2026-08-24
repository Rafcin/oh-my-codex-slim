import { AGENT_CATALOG } from "../agents/catalog.js";
import {
	canonicalizeCodexHome,
	resolveCodexHome,
} from "../config/codex-home.js";
import { readBoundedRegularFile } from "../config/safe-reader.js";
import type { RouterCapabilities } from "../router/types.js";
import { join } from "node:path";
import { agentsLifecycle } from "./agents-lifecycle.js";
import { resolvePackagedOmcsMarketplace } from "./plugin-marketplace.js";
import { omcsPackageRoot } from "./package-root.js";
import { mcpHealthHandshake } from "./mcp-health.js";
import { readOmcsPluginRegistration } from "./plugin-registration.js";

export interface StatusOptions {
	codexHome?: string;
	packageRoot?: string;
}
export interface StatusDependencies {
	mcpHandshake?: () => Promise<boolean>;
	routerCapabilities?: () => Promise<RouterCapabilities>;
	pluginRegistration?: () => Promise<boolean>;
}

export async function status(
	options: StatusOptions = {},
	dependencies: StatusDependencies = {},
) {
	const codexHome = await canonicalizeCodexHome(
		resolveCodexHome({ codexHome: options.codexHome }),
	);
	const packageRoot = options.packageRoot ?? omcsPackageRoot();
	const marketplace = await resolvePackagedOmcsMarketplace(packageRoot);
	let pluginConfigured = false;
	try {
		pluginConfigured = await (
			dependencies.pluginRegistration ??
			(() => readOmcsPluginRegistration({ codexHome }))
		)();
	} catch {
		pluginConfigured = false;
	}
	const agents = await agentsLifecycle("check", { codexHome });
	const mcpHealthy = await (dependencies.mcpHandshake ?? mcpHealthHandshake)();
	let config = "";
	try {
		config =
			(
				await readBoundedRegularFile(join(codexHome, "config.toml"), {
					label: "Codex config",
				})
			)?.toString("utf8") ?? "";
	} catch {
		/* absent config is native Codex */
	}
	const openCodexActive =
		/# Auto-injected by opencodex[\s\S]*?\bopenai_base_url\s*=/.test(config);
	return {
		product: { name: "oh-my-codex-slim", version: "0.1.0" },
		plugin: { packaged: Boolean(marketplace), configured: pluginConfigured },
		agents: {
			expected: AGENT_CATALOG.length,
			installed: agents.installed,
			healthy: agents.healthy,
		},
		mcp: {
			configured: pluginConfigured && Boolean(marketplace),
			healthy: mcpHealthy,
		},
		transport: {
			name: "opencodex",
			active: openCodexActive,
			credentialOwner: "opencodex",
		},
	};
}
