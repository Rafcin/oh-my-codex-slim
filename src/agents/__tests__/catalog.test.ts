import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import TOML from "@iarna/toml";
import { setup } from "../../cli/setup.js";
import { managedFilesManifestPath, writeManagedFile } from "../../config/managed-files.js";
import { AGENT_CATALOG } from "../catalog.js";
import { installAgentCatalog, renderAgentToml } from "../install.js";

async function fixtureCodexHome(): Promise<string> {
	return mkdtemp(join(await realpath(tmpdir()), "omcs-agent-catalog-"));
}

describe("native agent catalog", () => {
	it("pins the eight approved v1 roles, models, efforts, and permission postures", () => {
		assert.deepEqual(AGENT_CATALOG.map((agent) => [agent.name, agent.model, agent.effort, agent.permission]), [
			["omcs_architect", "gpt-5.6-sol", "high", "inherited"],
			["omcs_explorer", "gpt-5.6-luna", "low", "read-only"],
			["omcs_librarian", "gpt-5.6-luna", "medium", "read-only"],
			["omcs_oracle", "gpt-5.6-sol", "high", "read-only"],
			["omcs_fixer", "gpt-5.6-luna", "max", "inherited"],
			["omcs_terra_fixer", "gpt-5.6-terra", "high", "inherited"],
			["omcs_designer", "gpt-5.6-terra", "high", "inherited"],
			["omcs_reviewer", "gpt-5.6-sol", "high", "read-only"],
		]);
	});

	it("assigns the native routing, implementation, visual-proof, and review accountabilities", () => {
		const byName = Object.fromEntries(AGENT_CATALOG.map((agent) => [agent.name, agent]));
		assert.match(byName.omcs_architect.developerInstructions, /intent/i);
		assert.match(byName.omcs_architect.developerInstructions, /architecture/i);
		assert.match(byName.omcs_architect.developerInstructions, /routing/i);
		assert.match(byName.omcs_architect.developerInstructions, /decompos/i);
		assert.match(byName.omcs_architect.developerInstructions, /parent verification/i);
		assert.match(byName.omcs_architect.developerInstructions, /acceptance/i);

		for (const name of ["omcs_explorer", "omcs_librarian", "omcs_oracle"] as const) {
			assert.equal(byName[name].permission, "read-only");
			assert.doesNotMatch(byName[name].developerInstructions, /\bimplement(?:ation|ing)?\b/i);
			assert.doesNotMatch(byName[name].developerInstructions, /\bacceptance owner\b/i);
		}

		for (const name of ["omcs_fixer", "omcs_terra_fixer", "omcs_designer"] as const) {
			assert.equal(byName[name].permission, "inherited");
			assert.match(byName[name].developerInstructions, /exact(?:ly)? owned/i);
			assert.match(byName[name].developerInstructions, /others may edit concurrently/i);
			assert.match(byName[name].developerInstructions, /never revert unrelated work/i);
			assert.match(byName[name].developerInstructions, /structured report/i);
		}

		assert.match(byName.omcs_designer.developerInstructions, /visual proof/i);
		assert.match(byName.omcs_reviewer.developerInstructions, /fresh/i);
		assert.match(byName.omcs_reviewer.developerInstructions, /behaviorally read-only/i);
		assert.match(byName.omcs_reviewer.developerInstructions, /ship, fix-first, or rethink/i);
		assert.match(byName.omcs_reviewer.developerInstructions, /invalidates.*verdict/i);
		assert.match(byName.omcs_reviewer.developerInstructions, /parent reverification/i);
	});

	it("renders complete Codex TOML and grants read-only sandbox only to read-only roles", () => {
		for (const agent of AGENT_CATALOG) {
			const parsed = TOML.parse(renderAgentToml(agent)) as Record<string, unknown>;
			assert.equal(parsed.name, agent.name);
			assert.equal(parsed.description, agent.description);
			assert.equal(parsed.model, agent.model);
			assert.equal(parsed.model_reasoning_effort, agent.effort);
			assert.equal(parsed.developer_instructions, agent.developerInstructions);
			assert.equal(parsed.sandbox_mode, agent.permission === "read-only" ? "read-only" : undefined);
		}
	});

	it("plans and installs only the eight reserved omcs agent files without touching unrelated agents", async () => {
		const codexHome = await fixtureCodexHome();
		const unrelated = join(codexHome, "agents", "user-agent.toml");
		try {
			await import("node:fs/promises").then(({ mkdir }) => mkdir(join(codexHome, "agents"), { recursive: true }));
			await writeFile(unrelated, "keep me\n", "utf8");
			const clock = () => new Date("2026-08-22T21:00:00.000Z");
			const preview = await installAgentCatalog({ codexHome, dryRun: true, now: clock });
			assert.deepEqual(preview.changed, [
				"agents/omcs-architect.toml",
				"agents/omcs-designer.toml",
				"agents/omcs-explorer.toml",
				"agents/omcs-fixer.toml",
				"agents/omcs-librarian.toml",
				"agents/omcs-oracle.toml",
				"agents/omcs-reviewer.toml",
				"agents/omcs-terra-fixer.toml",
			]);
			assert.equal(existsSync(join(codexHome, "agents", "omcs-architect.toml")), false);

			assert.deepEqual(await installAgentCatalog({ codexHome, now: clock }), preview);
			assert.equal(await readFile(unrelated, "utf8"), "keep me\n");
			assert.deepEqual((await installAgentCatalog({ codexHome, now: clock })).unchanged, preview.changed);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("integrates all eight managed agents into setup dry-run and apply reports", async () => {
		const codexHome = await fixtureCodexHome();
		try {
			const expectedPaths = [
				"config.toml",
				"agents/omcs-architect.toml",
				"agents/omcs-designer.toml",
				"agents/omcs-explorer.toml",
				"agents/omcs-fixer.toml",
				"agents/omcs-librarian.toml",
				"agents/omcs-oracle.toml",
				"agents/omcs-reviewer.toml",
				"agents/omcs-terra-fixer.toml",
			];
			const preview = await setup({ codexHome, dryRun: true });
			assert.deepEqual(preview.changed, expectedPaths);
			assert.deepEqual(await setup({ codexHome }), preview);
			for (const relativePath of expectedPaths.slice(1)) {
				assert.equal(existsSync(join(codexHome, relativePath)), true, relativePath);
			}
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("rolls back config, earlier agents, and the manifest when a later agent write fails", async () => {
		const codexHome = await fixtureCodexHome();
		const unrelated = join(codexHome, "agents", "user-agent.toml");
		try {
			await import("node:fs/promises").then(({ mkdir }) => mkdir(join(codexHome, "agents"), { recursive: true }));
			await writeFile(unrelated, "keep me\n", "utf8");
			const managedPaths = [
				"config.toml",
				"agents/omcs-architect.toml",
				"agents/omcs-designer.toml",
				"agents/omcs-explorer.toml",
				"agents/omcs-fixer.toml",
				"agents/omcs-librarian.toml",
				"agents/omcs-oracle.toml",
				"agents/omcs-reviewer.toml",
				"agents/omcs-terra-fixer.toml",
			];
			for (const relativePath of managedPaths) {
				await writeManagedFile(join(codexHome, relativePath), Buffer.from(`prior ${relativePath}\n`), {
					codexHome,
					sourceVersion: "0.0.9",
					installedAt: "2026-08-22T20:59:00.000Z",
				});
			}
			const priorBytes = new Map(await Promise.all(managedPaths.map(async (relativePath) => [
				relativePath,
				await readFile(join(codexHome, relativePath)),
			] as const)));
			const priorManifest = await readFile(managedFilesManifestPath(codexHome));
			const priorRootEntries = (await readdir(codexHome)).sort();
			const priorAgentEntries = (await readdir(join(codexHome, "agents"))).sort();
			await assert.rejects(
				setup({ codexHome, now: () => new Date("2026-08-22T21:00:00.000Z") }, {
					writeManagedFile: async (path, bytes, options, dependencies) => {
						if (path.endsWith("/agents/omcs-fixer.toml")) throw new Error("later agent write denied");
						await writeManagedFile(path, bytes, options, dependencies);
					},
				}),
				/later agent write denied/,
			);
			for (const [relativePath, bytes] of priorBytes) {
				assert.deepEqual(await readFile(join(codexHome, relativePath)), bytes, relativePath);
			}
			assert.deepEqual(await readFile(managedFilesManifestPath(codexHome)), priorManifest);
			assert.deepEqual((await readdir(codexHome)).sort(), priorRootEntries);
			assert.deepEqual((await readdir(join(codexHome, "agents"))).sort(), priorAgentEntries);
			assert.equal(await readFile(unrelated, "utf8"), "keep me\n");
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("setup rollback removes every directory it created beneath a pre-existing parent", async () => {
		const parent = await fixtureCodexHome();
		const codexHome = join(parent, "new-a", "new-b", "codex-home");
		try {
			await writeFile(join(parent, "keep.txt"), "keep me\n", "utf8");
			const priorEntries = (await readdir(parent)).sort();
			await assert.rejects(setup({ codexHome }, {
				writeManagedFile: async (path, bytes, options, dependencies) => {
					if (path.endsWith("/agents/omcs-fixer.toml")) throw new Error("later setup agent write denied");
					await writeManagedFile(path, bytes, options, dependencies);
				},
			}), /later setup agent write denied/);
			assert.deepEqual((await readdir(parent)).sort(), priorEntries);
			assert.equal(await readFile(join(parent, "keep.txt"), "utf8"), "keep me\n");
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	});

	it("standalone install rollback removes every directory it created beneath a pre-existing parent", async () => {
		const parent = await fixtureCodexHome();
		const codexHome = join(parent, "new-a", "new-b", "codex-home");
		try {
			await writeFile(join(parent, "keep.txt"), "keep me\n", "utf8");
			const priorEntries = (await readdir(parent)).sort();
			await assert.rejects(installAgentCatalog({ codexHome }, {
				writeManagedFile: async (path, bytes, options, dependencies) => {
					if (path.endsWith("/agents/omcs-fixer.toml")) throw new Error("later standalone agent write denied");
					await writeManagedFile(path, bytes, options, dependencies);
				},
			}), /later standalone agent write denied/);
			assert.deepEqual((await readdir(parent)).sort(), priorEntries);
			assert.equal(await readFile(join(parent, "keep.txt"), "utf8"), "keep me\n");
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	});

	it("standalone install and setup report every ownership conflict without mutation", async () => {
		const codexHome = await fixtureCodexHome();
		try {
			await import("node:fs/promises").then(({ mkdir }) => mkdir(join(codexHome, "agents"), { recursive: true }));
			await writeFile(join(codexHome, "agents", "omcs-architect.toml"), "architect user data\n", "utf8");
			await writeFile(join(codexHome, "agents", "omcs-fixer.toml"), "fixer user data\n", "utf8");
			const expected = {
				changed: [],
				unchanged: [],
				conflicts: ["agents/omcs-architect.toml", "agents/omcs-fixer.toml"],
				backups: [],
			};
			assert.deepEqual(await installAgentCatalog({ codexHome }), expected);
			assert.deepEqual(await setup({ codexHome }), expected);
			assert.equal(await readFile(join(codexHome, "agents", "omcs-architect.toml"), "utf8"), "architect user data\n");
			assert.equal(await readFile(join(codexHome, "agents", "omcs-fixer.toml"), "utf8"), "fixer user data\n");
			assert.equal(existsSync(managedFilesManifestPath(codexHome)), false);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("setup preserves user config while aggregating every reserved-agent conflict before mutation", async () => {
		const codexHome = await fixtureCodexHome();
		try {
			await import("node:fs/promises").then(({ mkdir }) => mkdir(join(codexHome, "agents"), { recursive: true }));
			const priorFiles = new Map([
				["config.toml", "user config\n"],
				["agents/omcs-architect.toml", "architect user data\n"],
				["agents/omcs-fixer.toml", "fixer user data\n"],
			]);
			for (const [relativePath, bytes] of priorFiles) {
				await writeFile(join(codexHome, relativePath), bytes, "utf8");
			}
			assert.deepEqual(await setup({ codexHome }), {
				changed: [],
				unchanged: [],
				conflicts: ["agents/omcs-architect.toml", "agents/omcs-fixer.toml"],
				backups: [],
			});
			for (const [relativePath, bytes] of priorFiles) {
				assert.equal(await readFile(join(codexHome, relativePath), "utf8"), bytes, relativePath);
			}
			assert.equal(existsSync(managedFilesManifestPath(codexHome)), false);
			assert.deepEqual((await readdir(codexHome)).sort(), ["agents", "config.toml"]);
			assert.deepEqual((await readdir(join(codexHome, "agents"))).sort(), ["omcs-architect.toml", "omcs-fixer.toml"]);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});
});
