import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedRegularFile } from "../config/safe-reader.js";

interface PluginManifest {
	name: string;
	version: string;
	skills: string;
	mcpServers: string;
	apps: string;
	interface: { displayName: string; shortDescription: string; longDescription: string; developerName: string; category: string };
}

async function json(path: string): Promise<unknown> {
	const bytes = await readBoundedRegularFile(path, { maxBytes: 256 * 1024, label: "plugin document" });
	if (!bytes) throw new Error(`plugin document is missing: ${path}`);
	return JSON.parse(bytes.toString("utf8"));
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	for (const key of ["name", "version", "skills", "mcpServers", "apps"] satisfies Array<keyof PluginManifest>) {
		if (typeof manifest[key] !== "string" || manifest[key].length === 0) throw new Error(`plugin manifest ${key} is invalid`);
	}
	if (manifest.name !== "oh-my-codex-slim" || !object(manifest.interface)) throw new Error("plugin manifest identity is invalid");
	for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
		if (typeof manifest.interface[key] !== "string" || manifest.interface[key].length === 0) throw new Error(`plugin interface ${key} is invalid`);
	}
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
	const skillsRoot = contained(root, skillsPath);
	const entries = await readdir(skillsRoot, { withFileTypes: true });
	const skills = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
	if (skills.length !== 12) throw new Error("plugin skill catalog must contain exactly 12 skills");
	for (const skill of skills) {
		const definition = await readBoundedRegularFile(resolve(skillsRoot, skill.name, "SKILL.md"), { maxBytes: 256 * 1024, label: "skill definition" });
		if (!definition?.toString("utf8").startsWith("---\n")) throw new Error(`plugin skill ${skill.name} is invalid`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const root = process.argv[2];
	if (!root) throw new Error("plugin root argument is required");
	await validatePlugin(root);
	process.stdout.write("plugin validation passed\n");
}
