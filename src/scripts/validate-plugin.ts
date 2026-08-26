import { existsSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROFILES = ["auto", "fast", "thorough", "council"] as const;
const AGENTS = [
	"omcs_architect",
	"omcs_explorer",
	"omcs_librarian",
	"omcs_oracle",
	"omcs_fixer",
	"omcs_terra_fixer",
	"omcs_designer",
	"omcs_reviewer",
] as const;
const SENSITIVE_SETTING_KEY = /(?:credential|provider|account|token|secret|password|api[_-]?key|authorization|cookie)/i;

const safeReader = await import(
	existsSync(new URL("../config/safe-reader.ts", import.meta.url))
		? new URL("../config/safe-reader.ts", import.meta.url).href
		: new URL("../config/safe-reader.js", import.meta.url).href,
);
const { readBoundedRegularFile } = safeReader;

interface PluginManifest {
	name: string;
	version: string;
	description: string;
	keywords: unknown;
	skills: string;
	mcpServers: string;
	apps: string;
	interface: {
		displayName: string;
		shortDescription: string;
		longDescription: string;
		developerName: string;
		category: string;
		capabilities?: unknown;
		defaultPrompt?: unknown;
	};
}

async function json(path: string): Promise<unknown> {
	const bytes = await readBoundedRegularFile(path, { maxBytes: 256 * 1024, label: "plugin document" });
	if (!bytes) throw new Error(`plugin document is missing: ${path}`);
	return JSON.parse(bytes.toString("utf8"));
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeKeys(value: unknown, label: string): void {
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) assertSafeKeys(entry, `${label}[${index}]`);
		return;
	}
	if (!object(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		if (SENSITIVE_SETTING_KEY.test(key)) throw new Error(`${label} contains unsupported sensitive setting ${key}`);
		assertSafeKeys(entry, `${label}.${key}`);
	}
}

function exactStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw new Error(`${label} must be an array of strings`);
	}
	return value;
}

function contained(root: string, relativePath: string): string {
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${root}/`)) throw new Error("plugin path escapes root");
	return path;
}

/** Original OMCS validator; no upstream validator implementation was copied. */
export async function validatePlugin(pluginRoot: string): Promise<void> {
	const root = resolve(pluginRoot);
	const rootStat = await lstat(root);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("plugin root is unsafe");
	const manifest = await json(resolve(root, ".codex-plugin/plugin.json"));
	if (!object(manifest)) throw new Error("plugin manifest must be an object");
	assertSafeKeys(manifest, "plugin manifest");
	for (const key of ["name", "version", "skills", "mcpServers", "apps"] satisfies Array<keyof PluginManifest>) {
		if (typeof manifest[key] !== "string" || manifest[key].length === 0) throw new Error(`plugin manifest ${key} is invalid`);
	}
	if (typeof manifest.description !== "string" || !/orchestration system/i.test(manifest.description)) {
		throw new Error("plugin manifest description must describe an orchestration system");
	}
	const keywords = exactStringArray(manifest.keywords, "plugin manifest keywords");
	for (const profile of PROFILES) if (!keywords.includes(profile)) throw new Error(`plugin manifest is missing profile keyword ${profile}`);
	for (const agent of AGENTS) if (!keywords.includes(agent)) throw new Error(`plugin manifest is missing agent keyword ${agent}`);
	if (manifest.name !== "oh-my-codex-slim" || !object(manifest.interface)) throw new Error("plugin manifest identity is invalid");
	const pluginInterface = manifest.interface as PluginManifest["interface"];
	for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category"] as const) {
		if (typeof pluginInterface[key] !== "string" || pluginInterface[key].length === 0) throw new Error(`plugin interface ${key} is invalid`);
	}
	if (!/eight native agents/i.test(pluginInterface.longDescription)) throw new Error("plugin interface must describe the eight native agents");
	const defaultPrompt = exactStringArray(pluginInterface.defaultPrompt, "plugin interface defaultPrompt");
	if (!defaultPrompt.some((prompt) => /use omcs to solve this issue/i.test(prompt))) throw new Error("plugin default prompt must recommend omcs");
	if (!defaultPrompt.some((prompt) => /substantive engineering/i.test(prompt))) throw new Error("plugin default prompt must describe substantive engineering");
	const mcpPath = manifest.mcpServers as string;
	const appsPath = manifest.apps as string;
	const skillsPath = manifest.skills as string;
	if (mcpPath !== "./.mcp.json" || appsPath !== "./.app.json" || skillsPath !== "./skills/") throw new Error("plugin manifest paths are invalid");
	const mcp = await json(contained(root, mcpPath));
	const apps = await json(contained(root, appsPath));
	const hooks = await json(resolve(root, "hooks/hooks.json"));
	if (!object(mcp) || !object(mcp.mcpServers) || !object(apps) || !object(apps.apps) || !object(hooks) || !object(hooks.hooks)) {
		throw new Error("plugin auxiliary manifest is invalid");
	}
	if (Object.keys(apps.apps).length !== 0 || Object.keys(hooks.hooks).length !== 0) {
		throw new Error("plugin apps and hooks must remain inert");
	}
	const mcpServers = mcp.mcpServers;
	if (Object.keys(mcpServers).length !== 1 || !object(mcpServers.omcs_code_intel)) {
		throw new Error("plugin MCP manifest must contain only local code intelligence");
	}
	const codeIntel = mcpServers.omcs_code_intel;
	if (codeIntel.command !== "omcs" || JSON.stringify(codeIntel.args) !== JSON.stringify(["mcp-serve", "code-intel"]) || codeIntel.enabled !== true) {
		throw new Error("plugin MCP manifest must use the local OMCS code-intelligence command");
	}
	assertSafeKeys(mcp, "plugin MCP manifest");
	const skillsRoot = contained(root, skillsPath);
	const entries = await readdir(skillsRoot, { withFileTypes: true });
	const skills = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
	if (skills.length !== 16) throw new Error("plugin skill catalog must contain exactly 16 skills");
	const skillNames = new Set(skills.map((skill) => skill.name));
	for (const required of [
		"ai-slop-cleaner", "code-review", "codebase-design", "codemap", "context", "deep-interview", "deepwork", "diagnose",
		"implement", "omcs", "omcs-orchestrate", "plan", "research", "simplify", "tdd", "verification",
	]) if (!skillNames.has(required)) throw new Error(`plugin skill catalog is missing ${required}`);
	for (const skill of skills) {
		const definition = await readBoundedRegularFile(resolve(skillsRoot, skill.name, "SKILL.md"), { maxBytes: 256 * 1024, label: "skill definition" });
		if (!definition?.toString("utf8").startsWith("---\n")) throw new Error(`plugin skill ${skill.name} is invalid`);
	}
	const omcsDefinition = await readBoundedRegularFile(resolve(skillsRoot, "omcs", "SKILL.md"), { maxBytes: 256 * 1024, label: "OMCS skill definition" });
	if (!omcsDefinition || !/name: omcs\n/.test(omcsDefinition.toString("utf8")) || !/use omcs to solve this issue/i.test(omcsDefinition.toString("utf8"))) {
		throw new Error("plugin OMCS skill must be the default orchestration entrypoint");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const root = process.argv[2];
	if (!root) throw new Error("plugin root argument is required");
	await validatePlugin(root);
	process.stdout.write("plugin validation passed\n");
}
