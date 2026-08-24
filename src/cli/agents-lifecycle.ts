import { join } from "node:path";
import { AGENT_CATALOG } from "../agents/catalog.js";
import { agentRelativePath, installAgentCatalog, renderAgentToml } from "../agents/install.js";
import { canonicalizeCodexHome, resolveCodexHome } from "../config/codex-home.js";
import { readBoundedRegularFile } from "../config/safe-reader.js";

export type AgentsLifecycleAction = "install" | "check" | "list";

export interface AgentsLifecycleOptions {
	codexHome?: string;
	dryRun?: boolean;
}

async function listAgents(codexHome: string) {
	return Promise.all(AGENT_CATALOG.map(async (agent) => {
		let installed = false;
		try {
			installed = (await readBoundedRegularFile(join(codexHome, agentRelativePath(agent)), { maxBytes: 64 * 1024, label: "agent definition" }))?.toString("utf8") === renderAgentToml(agent);
		} catch {
			installed = false;
		}
		return { name: agent.name, model: agent.model, effort: agent.effort, permission: agent.permission, installed };
	}));
}

export async function agentsLifecycle(action: "install", options?: AgentsLifecycleOptions): ReturnType<typeof installAgentCatalog>;
export async function agentsLifecycle(action: "list", options?: AgentsLifecycleOptions): Promise<{ agents: Awaited<ReturnType<typeof listAgents>> }>;
export async function agentsLifecycle(action: "check", options?: AgentsLifecycleOptions): Promise<{ healthy: boolean; expected: number; installed: number; agents: Awaited<ReturnType<typeof listAgents>> }>;
export async function agentsLifecycle(action: AgentsLifecycleAction, options?: AgentsLifecycleOptions): Promise<unknown>;
export async function agentsLifecycle(action: AgentsLifecycleAction, options: AgentsLifecycleOptions = {}) {
	const codexHome = await canonicalizeCodexHome(resolveCodexHome({ codexHome: options.codexHome }));
	if (action === "install") return installAgentCatalog(options);
	const agents = await listAgents(codexHome);
	if (action === "list") return { agents };
	return { healthy: agents.every((agent) => agent.installed), expected: AGENT_CATALOG.length, installed: agents.filter((agent) => agent.installed).length, agents };
}
