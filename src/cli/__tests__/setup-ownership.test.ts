import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import TOML from "@iarna/toml";
import {
	managedFilesManifestPath,
	readManagedFilesManifest,
	writeManagedFile,
	type ManagedFileDependencies,
} from "../../config/managed-files.js";
import { setup } from "../setup.js";
import { uninstall } from "../uninstall.js";

const AGENT_PATHS = [
	"agents/omcs-architect.toml",
	"agents/omcs-designer.toml",
	"agents/omcs-explorer.toml",
	"agents/omcs-fixer.toml",
	"agents/omcs-librarian.toml",
	"agents/omcs-oracle.toml",
	"agents/omcs-reviewer.toml",
	"agents/omcs-terra-fixer.toml",
];

async function fixtureCodexHome(files: Record<string, string> = {}): Promise<string> {
	const home = await temporaryDirectory("omcs-setup-ownership-");
	for (const [relativePath, contents] of Object.entries(files)) {
		const path = join(home, relativePath);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, contents, "utf8");
	}
	return home;
}

async function temporaryDirectory(prefix: string): Promise<string> {
	return mkdtemp(join(await realpath(tmpdir()), prefix));
}

describe("omcs setup ownership", () => {
	it("preserves the Codex-owned marketplace table without duplicating TOML semantics", async () => {
		const codexMarketplace = [
			'[marketplaces.omcs-local]',
			'source_type = "local"',
			'source = "/Users/example/oh-my-codex-slim"',
			'',
		].join("\n");
		const home = await fixtureCodexHome({ "config.toml": codexMarketplace });
		try {
			const first = await setup({ codexHome: home, packageRoot: "/different-package-root" });
			assert.ok(first.changed.includes("config.toml"));
			const afterSetup = await readFile(join(home, "config.toml"), "utf8");
			assert.equal(afterSetup.match(/^\[marketplaces\.omcs-local\]$/gm)?.length, 1);
			assert.doesNotThrow(() => TOML.parse(afterSetup));
			assert.match(afterSetup, /# omcs:begin\n(?:#.*\n)*# omcs:end/);
			assert.match(afterSetup, /source = "\/Users\/example\/oh-my-codex-slim"/);

			const second = await setup({ codexHome: home, packageRoot: "/another-package-root" });
			assert.ok(second.unchanged.includes("config.toml"));
			assert.equal(await readFile(join(home, "config.toml"), "utf8"), afterSetup);

			await uninstall({ codexHome: home });
			const afterUninstall = await readFile(join(home, "config.toml"), "utf8");
			assert.equal(afterUninstall.match(/^\[marketplaces\.omcs-local\]$/gm)?.length, 1);
			assert.doesNotThrow(() => TOML.parse(afterUninstall));
			assert.match(afterUninstall, /source = "\/Users\/example\/oh-my-codex-slim"/);
		} finally { await rm(home, { recursive: true, force: true }); }
	});

	it("plans and applies the same clean user-scope config registration", async () => {
		const home = await fixtureCodexHome();
		const clock = () => new Date("2026-08-22T20:00:00.000Z");
		try {
			const dryRun = await setup({ codexHome: home, scope: "user", dryRun: true, now: clock });
			assert.deepEqual(dryRun, { changed: ["config.toml", ...AGENT_PATHS], unchanged: [], conflicts: [], backups: [] });
			assert.equal(existsSync(join(home, "config.toml")), false);
			assert.equal(existsSync(managedFilesManifestPath(home)), false);

			const applied = await setup({ codexHome: home, scope: "user", dryRun: false, now: clock });
			assert.deepEqual(applied, dryRun);
			const config = await readFile(join(home, "config.toml"), "utf8");
			assert.match(config, /# omcs:begin/);
			assert.match(config, /# OMCS lifecycle marker; Codex CLI owns marketplace registration\./);
			assert.doesNotMatch(config, /\[marketplaces\.omcs-local\]/);
			assert.deepEqual((await readManagedFilesManifest(home)).files.map((record) => record.path), [...AGENT_PATHS, "config.toml"]);
			assert.deepEqual(await setup({ codexHome: home, scope: "user", dryRun: false, now: clock }), {
				changed: [], unchanged: ["config.toml", ...AGENT_PATHS], conflicts: [], backups: [],
			});
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("does not rewrite lifecycle ownership when only the package root changes", async () => {
		const home = await fixtureCodexHome();
		try {
			await setup({ codexHome: home, packageRoot: "/package-a", now: () => new Date("2026-08-22T20:00:00.000Z") });
			const clock = () => new Date("2026-08-22T20:01:02.003Z");
			const dryRun = await setup({ codexHome: home, packageRoot: "/package-b", dryRun: true, now: clock });
			assert.deepEqual(dryRun, { changed: [], unchanged: ["config.toml", ...AGENT_PATHS], conflicts: [], backups: [] });
			assert.deepEqual(await setup({ codexHome: home, packageRoot: "/package-b", dryRun: false, now: clock }), dryRun);
			assert.doesNotMatch(await readFile(join(home, "config.toml"), "utf8"), /package-[ab]/);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("discovers the Git root before selecting a project-local Codex home", async () => {
		const projectRoot = await temporaryDirectory("omcs-project-scope-");
		const nestedWorkingDirectory = join(projectRoot, "packages", "widget");
		try {
			await mkdir(join(projectRoot, ".git"));
			await mkdir(nestedWorkingDirectory, { recursive: true });
			const report = await setup({ scope: "project", projectRoot: nestedWorkingDirectory, dryRun: false });
			assert.deepEqual(report.changed, ["config.toml", ...AGENT_PATHS]);
			assert.equal(existsSync(join(projectRoot, ".codex", "config.toml")), true);
			assert.equal(existsSync(join(nestedWorkingDirectory, ".codex")), false);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it("CLI parses valid scope and rejects missing or invalid scope values", async () => {
		const home = await fixtureCodexHome();
		try {
			const invalid = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli", "omcs.js"), "setup", "--scope", "invalid"], {
				encoding: "utf8", env: { ...process.env, CODEX_HOME: home },
			});
			assert.equal(invalid.status, 64);
			assert.equal(invalid.stderr, "omcs: --scope expects user or project\n");
			const valid = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli", "omcs.js"), "setup", "--scope", "user", "--dry-run", "--json"], {
				encoding: "utf8", env: { ...process.env, CODEX_HOME: home },
			});
			assert.equal(valid.status, 0, valid.stderr);
			assert.deepEqual(JSON.parse(valid.stdout), {
				command: "setup", dryRun: true, changed: ["config.toml", ...AGENT_PATHS], unchanged: [], conflicts: [], backups: [],
			});
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("setup refuses an unknown existing omcs agent", async () => {
		const home = await fixtureCodexHome({ "agents/omcs-fixer.toml": "user data" });
		try {
			const report = await setup({ codexHome: home, scope: "user", dryRun: false });
			assert.deepEqual(report.conflicts, ["agents/omcs-fixer.toml"]);
			assert.equal(await readFile(join(home, "agents/omcs-fixer.toml"), "utf8"), "user data");
			assert.equal(existsSync(managedFilesManifestPath(home)), false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("computes the same dry-run ownership decision without writing", async () => {
		const home = await fixtureCodexHome({ "agents/omcs-user.toml": "preserve me" });
		try {
			const dryRun = await setup({ codexHome: home, scope: "user", dryRun: true });
			const applied = await setup({ codexHome: home, scope: "user", dryRun: false });
			assert.deepEqual(dryRun, applied);
			assert.equal(await readFile(join(home, "agents/omcs-user.toml"), "utf8"), "preserve me");
			assert.equal(existsSync(managedFilesManifestPath(home)), false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("records only atomically written digest-matching OMCS files and backs up a replacement", async () => {
		const home = await fixtureCodexHome();
		const target = join(home, "agents", "omcs-safe.toml");
		try {
			const first = Buffer.from("first\n");
			await writeManagedFile(target, first, { codexHome: home, sourceVersion: "0.1.0" });
			assert.deepEqual(await readFile(target), first);
			const initialManifest = await readManagedFilesManifest(home);
			assert.deepEqual(initialManifest.files.map((record) => ({
				path: record.path,
				sha256: record.sha256,
				sourceVersion: record.sourceVersion,
			})), [{
				path: "agents/omcs-safe.toml",
				sha256: createHash("sha256").update(first).digest("hex"),
				sourceVersion: "0.1.0",
			}]);
			assert.match(initialManifest.files[0]?.installedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

			const second = Buffer.from("second\n");
			await writeManagedFile(target, second, { codexHome: home, sourceVersion: "0.1.1" });
			assert.deepEqual(await readFile(target), second);
			const agentEntries = await readdir(join(home, "agents"));
			const backupName = agentEntries.find((name) => /^omcs-safe\.toml\.bak-\d{4}-\d{2}-\d{2}T/.test(name));
			assert.ok(backupName, "replacement must retain a timestamped backup");
			assert.equal(await readFile(join(home, "agents", backupName), "utf8"), "first\n");

			await writeFile(target, "user edit\n", "utf8");
			await assert.rejects(
				writeManagedFile(target, Buffer.from("third\n"), { codexHome: home, sourceVersion: "0.1.2" }),
				/ownership conflict/i,
			);
			assert.equal(await readFile(target, "utf8"), "user edit\n");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("fails closed for reserved symlinks and non-directory agents roots", async () => {
		const home = await fixtureCodexHome({ "outside.toml": "outside" });
		try {
			await mkdir(join(home, "agents"));
			await symlink(join(home, "outside.toml"), join(home, "agents", "omcs-link.toml"));
			assert.deepEqual(await setup({ codexHome: home, dryRun: true }), {
				changed: [], unchanged: [], conflicts: ["agents/omcs-link.toml"], backups: [],
			});
			await rm(join(home, "agents"), { recursive: true, force: true });
			await writeFile(join(home, "agents"), "not a directory", "utf8");
			await assert.rejects(setup({ codexHome: home, dryRun: true }), /agents directory is unsafe/i);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("rejects a symlinked CODEX_HOME before any managed write", async () => {
		const physicalHome = await fixtureCodexHome();
		const linkParent = await temporaryDirectory("omcs-home-link-");
		const linkedHome = join(linkParent, "codex-home");
		try {
			await symlink(physicalHome, linkedHome);
			await assert.rejects(setup({ codexHome: linkedHome, dryRun: false }), /symlink/i);
			assert.equal(existsSync(join(physicalHome, "config.toml")), false);
		} finally {
			await rm(linkParent, { recursive: true, force: true });
			await rm(physicalHome, { recursive: true, force: true });
		}
	});

	it("rejects a symlinked intermediate CODEX_HOME ancestor", async () => {
		const base = await temporaryDirectory("omcs-canonical-home-");
		const physicalParent = join(base, "physical");
		const linkedParent = join(base, "linked");
		try {
			await mkdir(physicalParent);
			await symlink(physicalParent, linkedParent);
			await assert.rejects(setup({ codexHome: join(linkedParent, "codex-home"), dryRun: true }), /symlink/i);
			assert.equal(existsSync(join(physicalParent, "codex-home", "config.toml")), false);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	it("restores prior bytes when the manifest rename fails after a target replacement", async () => {
		const home = await fixtureCodexHome();
		const target = join(home, "agents", "omcs-rollback.toml");
		try {
			await writeManagedFile(target, Buffer.from("first\n"), { codexHome: home, sourceVersion: "0.1.0" });
			const manifestBefore = await readFile(managedFilesManifestPath(home));
			let failOnce = true;
			const dependencies: ManagedFileDependencies = { beforeReplace: async (to) => {
				if (failOnce && to.endsWith("/oh-my-codex-slim/managed-files.json")) {
					failOnce = false;
					throw new Error("manifest rename denied");
				}
			} };
			await assert.rejects(
				writeManagedFile(target, Buffer.from("second\n"), { codexHome: home, sourceVersion: "0.1.1" }, dependencies),
				/manifest rename denied/,
			);
			assert.equal(await readFile(target, "utf8"), "first\n");
			assert.deepEqual(await readFile(managedFilesManifestPath(home)), manifestBefore);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("leaves prior bytes and ownership intact when preparing the manifest fails", async () => {
		const home = await fixtureCodexHome();
		const target = join(home, "agents", "omcs-prepare-rollback.toml");
		try {
			await writeManagedFile(target, Buffer.from("first\n"), { codexHome: home, sourceVersion: "0.1.0" });
			const manifestBefore = await readFile(managedFilesManifestPath(home));
			let failOnce = true;
			const dependencies: ManagedFileDependencies = { writeTemporary: async (path, bytes, handle) => {
				if (failOnce && path.endsWith("/oh-my-codex-slim/managed-files.json")) {
					failOnce = false;
					await handle.writeFile(bytes);
					throw new Error("manifest write denied");
				}
				await handle.writeFile(bytes);
				await handle.sync();
			} };
			await assert.rejects(
				writeManagedFile(target, Buffer.from("second\n"), { codexHome: home, sourceVersion: "0.1.1" }, dependencies),
				/manifest write denied/,
			);
			assert.equal(await readFile(target, "utf8"), "first\n");
			assert.deepEqual(await readFile(managedFilesManifestPath(home)), manifestBefore);
			const entries = await readdir(join(home, "oh-my-codex-slim"));
			assert.equal(entries.some((entry) => entry.includes(".omcs-") && entry.endsWith(".tmp")), false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("keeps default calls isolated from a concurrent failing transaction", async () => {
		const firstHome = await fixtureCodexHome();
		const secondHome = await fixtureCodexHome();
		const firstTarget = join(firstHome, "agents", "omcs-first.toml");
		const secondTarget = join(secondHome, "agents", "omcs-second.toml");
		try {
			await Promise.all([
				writeManagedFile(firstTarget, Buffer.from("first\n"), { codexHome: firstHome, sourceVersion: "0.1.0" }),
				writeManagedFile(secondTarget, Buffer.from("first\n"), { codexHome: secondHome, sourceVersion: "0.1.0" }),
			]);
			const failing: ManagedFileDependencies = { writeTemporary: async (path, bytes, handle) => {
				await handle.writeFile(bytes);
				if (path.endsWith("/oh-my-codex-slim/managed-files.json")) throw new Error("isolated failure");
				await handle.sync();
			} };
			const [failed, succeeded] = await Promise.allSettled([
				writeManagedFile(firstTarget, Buffer.from("second\n"), { codexHome: firstHome, sourceVersion: "0.1.1" }, failing),
				writeManagedFile(secondTarget, Buffer.from("second\n"), { codexHome: secondHome, sourceVersion: "0.1.1" }),
			]);
			assert.equal(failed.status, "rejected");
			assert.equal(succeeded.status, "fulfilled");
			assert.equal(await readFile(firstTarget, "utf8"), "first\n");
			assert.equal(await readFile(secondTarget, "utf8"), "second\n");
		} finally {
			await rm(firstHome, { recursive: true, force: true });
			await rm(secondHome, { recursive: true, force: true });
		}
	});

	it("rebases the managed config block onto user bytes changed after planning", async () => {
		const home = await fixtureCodexHome({ "config.toml": "user_before = true\n" });
		try {
			let raced = false;
			await setup({ codexHome: home }, { writeManagedFile: async (path, bytes, options) => {
				if (!raced && path.endsWith("/config.toml")) {
					raced = true;
					await writeFile(path, "user_before = true\nuser_concurrent = true\n", "utf8");
				}
				await writeManagedFile(path, bytes, options);
			} });
			const config = await readFile(join(home, "config.toml"), "utf8");
			assert.match(config, /user_concurrent = true/);
			assert.match(config, /# omcs:begin/);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("does not clobber a concurrent config replacement during batch rollback", async () => {
		const home = await fixtureCodexHome({ "config.toml": "user_before = true\n" });
		try {
			let writes = 0;
			await assert.rejects(setup({ codexHome: home }, { writeManagedFile: async (path, bytes, options) => {
				writes += 1;
				if (writes === 2) {
					await writeFile(join(home, "config.toml"), "concurrent owner\n", "utf8");
					throw new Error("synthetic later write failure");
				}
				await writeManagedFile(path, bytes, options);
			} }), /rollback failed|synthetic later write failure/i);
			assert.equal(await readFile(join(home, "config.toml"), "utf8"), "concurrent owner\n");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("preserves user bytes rebased during a config write when a later batch write fails", async () => {
		const home = await fixtureCodexHome({ "config.toml": "user_before = true\n" });
		try {
			let writes = 0;
			await assert.rejects(setup({ codexHome: home }, { writeManagedFile: async (path, bytes, options) => {
				writes += 1;
				if (writes === 1) {
					await writeFile(path, "user_before = true\nuser_concurrent = true\n", "utf8");
					await writeManagedFile(path, bytes, options);
					return;
				}
				throw new Error("synthetic later write failure");
			} }), /synthetic later write failure/i);
			const config = await readFile(join(home, "config.toml"), "utf8");
			assert.match(config, /user_concurrent = true/);
			assert.doesNotMatch(config, /# omcs:begin/);
		} finally { await rm(home, { recursive: true, force: true }); }
	});

	it("refuses a config replacement injected inside the final commit boundary", async () => {
		const home = await fixtureCodexHome({ "config.toml": "user_before = true\n" });
		const target = join(home, "config.toml");
		try {
			let raced = false;
			await assert.rejects(writeManagedFile(target, Buffer.from("# omcs:begin\nmanaged = true\n# omcs:end\n"), {
				codexHome: home, sourceVersion: "0.1.0",
			}, { rename: async (from, to) => {
				if (!raced && (to === target || from === target)) {
					raced = true;
					await writeFile(target, "concurrent owner\n");
				}
				await (await import("node:fs/promises")).rename(from, to);
			} }), /changed|concurrent|rollback/i);
			assert.equal(await readFile(target, "utf8"), "concurrent owner\n");
		} finally { await rm(home, { recursive: true, force: true }); }
	});

	it("preserves a concurrent backup replacement during later batch rollback", async () => {
		const home = await fixtureCodexHome({ "config.toml": "user_before = true\n" });
		const stamp = "2026-08-23T01:02:03.004Z";
		const backup = join(home, "config.toml.bak-2026-08-23T01-02-03-004Z");
		try {
			let writes = 0;
			await assert.rejects(setup({ codexHome: home, now: () => new Date(stamp) }, { writeManagedFile: async (path, bytes, options) => {
				writes += 1;
				if (writes === 1) { await writeManagedFile(path, bytes, options); return; }
				await rm(backup, { force: true });
				await writeFile(backup, "concurrent backup owner\n");
				throw new Error("later batch failure");
			} }), /rollback failed|later batch failure/i);
			assert.equal(await readFile(backup, "utf8"), "concurrent backup owner\n");
		} finally { await rm(home, { recursive: true, force: true }); }
	});
});
