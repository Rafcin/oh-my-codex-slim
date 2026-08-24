import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const repositoryRoot = process.cwd();
const pluginRoot = join(repositoryRoot, "plugins", "oh-my-codex-slim");

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("OMCS native plugin contract", () => {
	it("plugin manifest names only real companion files", () => {
		const manifest = readJson(join(pluginRoot, ".codex-plugin", "plugin.json"));
		assert.equal(manifest.name, "oh-my-codex-slim");
		assert.equal(manifest.skills, "./skills/");
		assert.equal(manifest.mcpServers, "./.mcp.json");
		assert.equal(manifest.apps, "./.app.json");
		assert.equal("hooks" in manifest, false, "hooks are discoverable by companion path, not unsupported manifest metadata");
		assert.equal(existsSync(join(pluginRoot, "skills")), true);
		assert.equal(existsSync(join(pluginRoot, ".mcp.json")), true);
		assert.equal(existsSync(join(pluginRoot, ".app.json")), true);
		assert.equal(existsSync(join(pluginRoot, "hooks", "hooks.json")), true);
		assert.equal(existsSync(join(pluginRoot, "hooks", "omcs-hook.mjs")), true);
		assert.equal((manifest.interface as Record<string, unknown>).category, "Developer Tools");
		assert.ok(Array.isArray((manifest.interface as Record<string, unknown>).defaultPrompt));
		assert.ok(((manifest.interface as Record<string, unknown>).defaultPrompt as unknown[]).every((prompt) => typeof prompt === "string"));
	});

	it("advertises the repo-local OMCS plugin with explicit availability policy", () => {
		const marketplace = readJson(join(repositoryRoot, ".agents", "plugins", "marketplace.json"));
		assert.equal(marketplace.name, "omcs-local");
		assert.equal((marketplace.interface as Record<string, unknown>).displayName, "OMCS Local Plugins");
		const entry = (marketplace.plugins as Array<Record<string, unknown>>).find((candidate) => candidate.name === "oh-my-codex-slim");
		assert.deepEqual(entry, {
			name: "oh-my-codex-slim",
			source: { source: "local", path: "./plugins/oh-my-codex-slim" },
			policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
			category: "Developer Tools",
		});
		assert.deepEqual((marketplace.plugins as Array<Record<string, unknown>>).map((candidate) => candidate.name), ["oh-my-codex-slim"]);
	});

	it("launches only the OMCS v1 code-intelligence server", () => {
		const mcp = readJson(join(pluginRoot, ".mcp.json"));
		assert.deepEqual(mcp, {
			mcpServers: {
				omcs_code_intel: {
					command: "omcs",
					args: ["mcp-serve", "code-intel"],
					enabled: true,
				},
			},
		});
	});
});
