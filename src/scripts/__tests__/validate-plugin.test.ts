import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validatePlugin } from "../validate-plugin.js";

describe("repository-owned plugin validator", () => {
	it("accepts the packaged OMCS plugin", async () => {
		await validatePlugin(join(process.cwd(), "plugins", "oh-my-codex-slim"));
	});

	it("publishes OMCS as the orchestration entrypoint with its complete profile and agent roster", async () => {
		const root = join(process.cwd(), "plugins", "oh-my-codex-slim");
		const manifest = JSON.parse(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8")) as {
			description?: unknown;
			keywords?: unknown;
			interface?: { defaultPrompt?: unknown[]; longDescription?: unknown };
		};
		const keywords = manifest.keywords as string[];
		const defaultPrompt = manifest.interface?.defaultPrompt as string[];

		assert.match(String(manifest.description), /orchestration system/i);
		assert.deepEqual(
			keywords.filter((keyword) => ["auto", "fast", "thorough", "council"].includes(keyword)),
			["auto", "fast", "thorough", "council"],
		);
		assert.deepEqual(
			keywords.filter((keyword) => keyword.startsWith("omcs_")),
			[
				"omcs_architect",
				"omcs_explorer",
				"omcs_librarian",
				"omcs_oracle",
				"omcs_fixer",
				"omcs_terra_fixer",
				"omcs_designer",
				"omcs_reviewer",
			],
		);
		assert.match(String(manifest.interface?.longDescription), /eight native agents/i);
		assert.ok(defaultPrompt.some((prompt) => /use omcs to solve this issue/i.test(prompt)));
		assert.ok(defaultPrompt.some((prompt) => /substantive engineering/i.test(prompt)));
	});

	it("keeps Codex companion surfaces local, inert, and free of provider settings", async () => {
		const root = join(process.cwd(), "plugins", "oh-my-codex-slim");
		const app = JSON.parse(await readFile(join(root, ".app.json"), "utf8")) as Record<string, unknown>;
		const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as Record<string, unknown>;
		const hooks = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8")) as Record<string, unknown>;
		const manifest = JSON.parse(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;

		assert.deepEqual(app, { apps: {} });
		assert.deepEqual(hooks, { hooks: {} });
		assert.deepEqual(mcp, {
			mcpServers: {
				omcs_code_intel: {
					command: "omcs",
					args: ["mcp-serve", "code-intel"],
					enabled: true,
				},
			},
		});
		const serialized = JSON.stringify(manifest);
		assert.doesNotMatch(serialized, /(?:credential|provider|apiKey|secret|token|password)/i);
	});

	it("rejects a malformed plugin without using a mutable user validator", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-bad-plugin-"));
		try {
			await mkdir(join(root, ".codex-plugin"));
			await writeFile(join(root, ".codex-plugin", "plugin.json"), "{}\n");
			await assert.rejects(validatePlugin(root), /plugin|manifest|name/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
