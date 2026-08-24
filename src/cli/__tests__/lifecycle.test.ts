import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
	appendFile,
	link,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { AGENT_CATALOG } from "../../agents/catalog.js";
import { hasManagedConfigBlock } from "../../config/generator.js";
import type { RouterCapabilities } from "../../router/types.js";
import { agentsLifecycle } from "../agents-lifecycle.js";
import { doctor } from "../doctor.js";
import { routerLifecycle } from "../router-lifecycle.js";
import { setup } from "../setup.js";
import { status } from "../status.js";
import { uninstall } from "../uninstall.js";
import { update } from "../update.js";

const PACKAGE_ROOT = process.cwd();

async function fixture(): Promise<string> {
	return mkdtemp(join(await realpath(tmpdir()), "omcs-lifecycle-"));
}

const missingRouter: RouterCapabilities = {
	installed: false,
	healthy: false,
	version: null,
	subagentMode: "unavailable",
	enabledAgents: [],
	disabledAgents: [],
};

describe("OMCS lifecycle", () => {
	it("uses a stateless managed-block detector", () => {
		const config = "user = true\n# omcs:begin\nmanaged = true\n# omcs:end\n";
		assert.equal(hasManagedConfigBlock(config), true);
		assert.equal(hasManagedConfigBlock(config), true);
	});

	it("setup is idempotent and uninstall preserves unrelated state", async () => {
		const codexHome = await fixture();
		try {
			await writeFile(
				join(codexHome, "config.toml"),
				"user_setting = true\n",
				"utf8",
			);
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			await appendFile(
				join(codexHome, "config.toml"),
				"user_after_setup = true\n",
			);
			assert.deepEqual(
				(await update({ codexHome, packageRoot: PACKAGE_ROOT })).changed,
				["config.toml"],
			);
			assert.match(
				await readFile(join(codexHome, "config.toml"), "utf8"),
				/user_after_setup = true/,
			);
			await writeFile(
				join(codexHome, "agents", "user-agent.toml"),
				"keep\n",
				"utf8",
			);
			await mkdir(join(codexHome, "router-install"));
			await mkdir(join(codexHome, "opencodex-data"));
			await mkdir(join(codexHome, "migration-backups"));

			const dryRun = await uninstall({ codexHome, dryRun: true });
			assert.equal(dryRun.changed.length, 9);
			assert.equal(
				existsSync(join(codexHome, "agents", "omcs-architect.toml")),
				true,
			);

			const report = await uninstall({ codexHome });
			assert.equal(report.conflicts.length, 0);
			assert.equal(
				await readFile(join(codexHome, "agents", "user-agent.toml"), "utf8"),
				"keep\n",
			);
			assert.match(
				await readFile(join(codexHome, "config.toml"), "utf8"),
				/^user_setting = true/m,
			);
			assert.doesNotMatch(
				await readFile(join(codexHome, "config.toml"), "utf8"),
				/omcs:begin/,
			);
			for (const directory of [
				"router-install",
				"opencodex-data",
				"migration-backups",
			]) {
				assert.equal(existsSync(join(codexHome, directory)), true);
			}
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("refuses drift inside the owned config block while allowing user bytes outside it", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const path = join(codexHome, "config.toml");
			const current = await readFile(path, "utf8");
			await writeFile(
				path,
				current.replace("OMCS lifecycle marker", "unknown-owner marker"),
			);
			assert.deepEqual(
				(await update({ codexHome, packageRoot: PACKAGE_ROOT })).conflicts,
				["config.toml"],
			);
			assert.deepEqual((await uninstall({ codexHome })).conflicts, [
				"config.toml",
			]);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("uninstall fails closed for drift and unsafe file identities", async () => {
		for (const kind of ["modified", "symlink", "hardlink"] as const) {
			const codexHome = await fixture();
			try {
				await setup({ codexHome, packageRoot: PACKAGE_ROOT });
				const target = join(codexHome, "agents", "omcs-fixer.toml");
				if (kind === "modified") await writeFile(target, "user edit\n");
				if (kind === "symlink") {
					await rm(target);
					await symlink(join(codexHome, "config.toml"), target);
				}
				if (kind === "hardlink")
					await link(target, join(codexHome, "agents", "copy.toml"));
				const report = await uninstall({ codexHome });
				assert.deepEqual(report.changed, []);
				assert.ok(report.conflicts.includes("agents/omcs-fixer.toml"));
				assert.equal(
					existsSync(join(codexHome, "agents", "omcs-architect.toml")),
					true,
				);
			} finally {
				await rm(codexHome, { recursive: true, force: true });
			}
		}
	});

	it("rolls back every lifecycle file when a removal fails partway", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const before = await readFile(join(codexHome, "config.toml"));
			let calls = 0;
			await assert.rejects(
				uninstall(
					{ codexHome },
					{
						beforeMutation: async () => {
							calls += 1;
							if (calls === 4) throw new Error("synthetic removal failure");
						},
					},
				),
				/synthetic removal failure/,
			);
			assert.deepEqual(await readFile(join(codexHome, "config.toml")), before);
			for (const agent of AGENT_CATALOG) {
				assert.equal(
					existsSync(
						join(
							codexHome,
							"agents",
							`${agent.name.replaceAll("_", "-")}.toml`,
						),
					),
					true,
				);
			}
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("refuses a target replaced immediately before removal without deleting the replacement", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const target = join(codexHome, "agents", "omcs-fixer.toml");
			await assert.rejects(
				uninstall(
					{ codexHome },
					{
						beforeMutation: async (relativePath) => {
							if (relativePath === "agents/omcs-fixer.toml")
								await writeFile(target, "concurrent owner\n");
						},
					},
				),
				/changed during uninstall|rollback failed/i,
			);
			assert.equal(await readFile(target, "utf8"), "concurrent owner\n");
			assert.equal(
				existsSync(join(codexHome, "agents", "omcs-architect.toml")),
				true,
			);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	for (const racedPath of [
		"config.toml",
		"agents/omcs-fixer.toml",
		"oh-my-codex-slim/managed-files.json",
		"config.toml.bak-2026-08-23T00-00-00-000Z",
	]) {
		it(`refuses a ${racedPath} replacement after validation without deleting it`, async () => {
			const codexHome = await fixture();
			try {
				await setup({ codexHome, packageRoot: PACKAGE_ROOT });
				const target = join(codexHome, racedPath);
				let raced = false;
				await assert.rejects(
					uninstall(
						{ codexHome, now: () => new Date("2026-08-23T00:00:00.000Z") },
						{
							afterValidation: async (relativePath) => {
								if (raced || relativePath !== racedPath) return;
								raced = true;
								await rm(target, { force: true });
								await writeFile(target, "concurrent owner\n");
							},
						},
					),
					/changed|concurrent|rollback failed/i,
				);
				assert.equal(await readFile(target, "utf8"), "concurrent owner\n");
			} finally {
				await rm(codexHome, { recursive: true, force: true });
			}
		});
	}

	for (const rollbackPath of [
		"config.toml",
		"config.toml.bak-2026-08-23T02-00-00-000Z",
	]) {
		it(`preserves a concurrent ${rollbackPath} replacement inside rollback cleanup`, async () => {
			const codexHome = await fixture();
			const target = join(codexHome, rollbackPath);
			try {
				await setup({ codexHome, packageRoot: PACKAGE_ROOT });
				let failedForward = false;
				let racedRollback = false;
				await assert.rejects(
					uninstall(
						{ codexHome, now: () => new Date("2026-08-23T02:00:00.000Z") },
						{
							beforeMutation: async (relativePath) => {
								if (
									!failedForward &&
									relativePath === "agents/omcs-fixer.toml"
								) {
									failedForward = true;
									throw new Error("force rollback");
								}
							},
							beforeRollbackMutation: async (relativePath) => {
								if (racedRollback || relativePath !== rollbackPath) return;
								racedRollback = true;
								await rm(target, { force: true });
								await writeFile(target, "concurrent rollback owner\n");
							},
						},
					),
					/rollback failed|force rollback/i,
				);
				assert.equal(
					await readFile(target, "utf8"),
					"concurrent rollback owner\n",
				);
			} finally {
				await rm(codexHome, { recursive: true, force: true });
			}
		});
	}

	it("doctor returns the exact schema without requiring a legacy Router", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const report = await doctor(
				{ codexHome, packageRoot: PACKAGE_ROOT, nodeVersion: "v22.19.0" },
				{
					codexVersion: async () => "codex-cli 1.0.0",
					mcpHandshake: async () => true,
					routerCapabilities: async () => missingRouter,
					pluginRegistration: async () => true,
				},
			);
			assert.deepEqual(Object.keys(report), [
				"ok",
				"checks",
				"warnings",
				"errors",
			]);
			assert.equal(report.ok, true);
			assert.equal(report.checks.length, 8);
			assert.equal(
				report.checks.find((check) => check.name === "agents")?.message,
				"8/8 managed agents healthy",
			);
			assert.deepEqual(report.warnings, []);
			assert.deepEqual(report.errors, []);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("doctor accepts active OpenCodex routing and does not invoke legacy Router discovery", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const configured = await readFile(join(codexHome, "config.toml"), "utf8");
			await writeFile(
				join(codexHome, "config.toml"),
				`${configured}\n# Auto-injected by opencodex\nopenai_base_url = "http://127.0.0.1:9999"\n`,
			);
			const report = await doctor(
				{ codexHome, packageRoot: PACKAGE_ROOT, nodeVersion: "v22.19.0" },
				{
					codexVersion: async () => "codex-cli 1.0.0",
					mcpHandshake: async () => true,
					pluginRegistration: async () => true,
					routerCapabilities: async () => {
						throw new Error("client_secret=synthetic-secret malformed");
					},
				},
			);
			assert.equal(report.ok, true);
			assert.equal(
				report.checks.find((check) => check.name === "opencodex")?.ok,
				true,
			);
			assert.match(
				report.checks.find((check) => check.name === "opencodex")?.message ??
					"",
				/active/i,
			);
			assert.doesNotMatch(JSON.stringify(report), /synthetic-secret/);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("status is read-only and exposes the supported OpenCodex transport shape", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const report = await status(
				{ codexHome, packageRoot: PACKAGE_ROOT },
				{
					mcpHandshake: async () => true,
					pluginRegistration: async () => true,
					routerCapabilities: async () => ({
						...missingRouter,
						installed: true,
						version: "0.4.0-beta.4",
						enabledAgents: [],
					}),
				},
			);
			assert.deepEqual(Object.keys(report), [
				"product",
				"plugin",
				"agents",
				"mcp",
				"transport",
			]);
			assert.deepEqual(report.product, {
				name: "oh-my-codex-slim",
				version: "0.1.0",
			});
			assert.equal(report.agents.expected, 8);
			assert.deepEqual(report.transport, {
				name: "opencodex",
				active: false,
				credentialOwner: "opencodex",
			});
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("fails closed when Codex does not prove the OMCS plugin installed and enabled", async () => {
		const codexHome = await fixture();
		try {
			await setup({ codexHome, packageRoot: PACKAGE_ROOT });
			const state = await status(
				{ codexHome, packageRoot: PACKAGE_ROOT },
				{
					mcpHandshake: async () => true,
					pluginRegistration: async () => false,
					routerCapabilities: async () => missingRouter,
				},
			);
			assert.equal(state.plugin.configured, false);
			const report = await doctor(
				{ codexHome, packageRoot: PACKAGE_ROOT, nodeVersion: "v22.19.0" },
				{
					codexVersion: async () => "codex-cli 1.0.0",
					mcpHandshake: async () => true,
					pluginRegistration: async () => false,
					routerCapabilities: async () => missingRouter,
				},
			);
			assert.equal(report.ok, false);
			assert.deepEqual(
				report.checks.find((check) => check.name === "plugin"),
				{
					name: "plugin",
					ok: false,
					message:
						"Codex does not report oh-my-codex-slim@omcs-local installed and enabled",
				},
			);
			assert.match(report.errors.join("\n"), /installed and enabled/i);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("reports plugin-provided MCP configured from Codex proof without using the lifecycle marker", async () => {
		const codexHome = await fixture();
		try {
			const state = await status(
				{ codexHome, packageRoot: PACKAGE_ROOT },
				{
					mcpHandshake: async () => true,
					pluginRegistration: async () => true,
					routerCapabilities: async () => missingRouter,
				},
			);
			assert.equal(state.plugin.configured, true);
			assert.equal(state.mcp.configured, true);
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});

	it("canonicalizes CODEX_HOME before doctor, status, or agent lifecycle reads", async () => {
		const physical = await fixture();
		const parent = await fixture();
		const linked = join(parent, "linked-codex-home");
		try {
			await symlink(physical, linked);
			await assert.rejects(
				agentsLifecycle("list", { codexHome: linked }),
				/symlink/i,
			);
			await assert.rejects(
				status(
					{ codexHome: linked, packageRoot: PACKAGE_ROOT },
					{
						mcpHandshake: async () => true,
						routerCapabilities: async () => missingRouter,
					},
				),
				/symlink/i,
			);
			await assert.rejects(
				doctor(
					{
						codexHome: linked,
						packageRoot: PACKAGE_ROOT,
						nodeVersion: "v22.19.0",
					},
					{
						codexVersion: async () => "codex-cli 1.0.0",
						mcpHandshake: async () => true,
						routerCapabilities: async () => missingRouter,
					},
				),
				/symlink/i,
			);
		} finally {
			await rm(parent, { recursive: true, force: true });
			await rm(physical, { recursive: true, force: true });
		}
	});

	it("implements exact agents and non-mutating Router lifecycle commands", async () => {
		const codexHome = await fixture();
		try {
			assert.equal(
				(await agentsLifecycle("list", { codexHome })).agents.length,
				8,
			);
			assert.equal(
				(await agentsLifecycle("check", { codexHome })).healthy,
				false,
			);
			await agentsLifecycle("install", { codexHome });
			assert.equal(
				(await agentsLifecycle("check", { codexHome })).healthy,
				true,
			);

			const announced: string[] = [];
			let executed = false;
			const install = await routerLifecycle(
				"install",
				{ dryRun: true, sourceRoot: "/pinned/codex-router" },
				{
					announce: (line) => announced.push(line),
					execute: async () => {
						executed = true;
						return { stdout: "", stderr: "" };
					},
				},
			);
			assert.deepEqual(install.command, [
				"/pinned/codex-router/install.sh",
				"--target",
				"codex",
				"--no-provider",
				"--no-discovery",
				"--no-tray",
			]);
			assert.equal(executed, false);
			assert.match(announced.join("\n"), /install\.sh/);
			for (const action of ["update", "panel"] as const) {
				const plan = await routerLifecycle(action, { dryRun: true });
				assert.deepEqual(plan.command, ["codex-router", action]);
			}
		} finally {
			await rm(codexHome, { recursive: true, force: true });
		}
	});
});
