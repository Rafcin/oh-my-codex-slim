import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
	readMigrationManifest,
	type MigrationManifest,
	writeMigrationManifest,
} from "../migration-manifest.js";

async function fixture(t: TestContext): Promise<{ root: string; path: string; manifest: MigrationManifest }> {
	const root = await mkdtemp(join(tmpdir(), "omcs-migration-manifest-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "opencodex-migration.json");
	const manifest: MigrationManifest = {
		phase: "verified",
		paths: {
			codexConfig: join(root, "config.toml"),
			catalog: join(root, "catalog.json"),
			openCodexHome: join(root, "opencodex"),
			backup: join(root, "config.toml.backup"),
			manifest: path,
		},
		digests: {
			configBefore: "1".repeat(64),
			catalog: "2".repeat(64),
			native: "3".repeat(64),
			backup: "1".repeat(64),
			router: "4".repeat(64),
		},
		services: {
			openCodexBefore: "running",
			routerIntegrationBefore: "disabled",
			routerServiceBefore: "running",
		},
	};
	await writeMigrationManifest(path, manifest);
	return { root, path, manifest };
}

test("manifest replacement after descriptor open cannot control parsed rollback state", async (t) => {
	const state = await fixture(t);
	const originalBytes = await readFile(state.path);
	const replacementPath = join(state.root, "replacement.json");
	const displacedPath = join(state.root, "displaced.json");
	const sentinelPath = join(state.root, "must-not-change.toml");
	const sentinel = Buffer.from("user-owned sentinel\n");
	await writeFile(sentinelPath, sentinel);
	const replacement: MigrationManifest = {
		...state.manifest,
		phase: "rolled-back",
		paths: { ...state.manifest.paths, codexConfig: sentinelPath },
	};
	await writeFile(replacementPath, `${JSON.stringify(replacement)}\n`);

	await assert.rejects(
		readMigrationManifest(state.path, {
			afterOpen: async () => {
				await rename(state.path, displacedPath);
				await rename(replacementPath, state.path);
			},
		}),
		/changed|safe regular file/i,
	);
	assert.deepEqual(await readFile(displacedPath), originalBytes);
	assert.equal(JSON.parse(await readFile(state.path, "utf8")).phase, "rolled-back");
	assert.deepEqual(await readFile(sentinelPath), sentinel);
});

test("manifest reads remain bounded and reject malformed documents", async (t) => {
	const oversized = await fixture(t);
	await writeFile(oversized.path, "x".repeat(64 * 1024 + 1));
	await assert.rejects(readMigrationManifest(oversized.path), /safe regular file|bounded/i);

	const malformed = await fixture(t);
	await writeFile(malformed.path, "{not-json}\n");
	await assert.rejects(readMigrationManifest(malformed.path), /unreadable or malformed/i);
});

test("manifest reads reject symlink and hard-link ambiguity", async (t) => {
	const symbolic = await fixture(t);
	const target = join(symbolic.root, "manifest-target.json");
	await rename(symbolic.path, target);
	await symlink(target, symbolic.path);
	await assert.rejects(readMigrationManifest(symbolic.path), /safe regular file/i);

	const hardLinked = await fixture(t);
	await link(hardLinked.path, join(hardLinked.root, "manifest-hardlink.json"));
	await assert.rejects(readMigrationManifest(hardLinked.path), /safe regular file/i);
});

test("manifest creation never replaces a target that appears before commit", async (t) => {
	const state = await fixture(t);
	await unlink(state.path);
	const foreign = Buffer.from("foreign manifest owner\n");

	await assert.rejects(
		writeMigrationManifest(state.path, state.manifest, {
			beforeCommit: () => writeFile(state.path, foreign, { flag: "wx", mode: 0o600 }),
		}),
		/appeared|changed|exist/i,
	);
	assert.deepEqual(await readFile(state.path), foreign);
});

test("manifest update leaves a foreign replacement instead of overwriting it", async (t) => {
	const state = await fixture(t);
	const original = await readFile(state.path);
	const displaced = join(state.root, "original-manifest.json");
	const foreign = Buffer.from("foreign replacement\n");

	await assert.rejects(
		writeMigrationManifest(state.path, { ...state.manifest, phase: "rolled-back" }, {
			beforeCommit: async () => {
				await rename(state.path, displaced);
				await writeFile(state.path, foreign, { flag: "wx", mode: 0o600 });
			},
		}),
		/changed|replacement|ownership/i,
	);
	assert.deepEqual(await readFile(state.path), foreign);
	assert.deepEqual(await readFile(displaced), original);
});

test("manifest update leaves a foreign directory at the original path", async (t) => {
	const state = await fixture(t);
	const displaced = join(state.root, "original-manifest.json");

	await assert.rejects(
		writeMigrationManifest(state.path, { ...state.manifest, phase: "rolled-back" }, {
			beforeCommit: async () => {
				await rename(state.path, displaced);
				await mkdir(state.path);
			},
		}),
		/safe regular file|changed|ownership/i,
	);
	assert.equal((await lstat(state.path)).isDirectory(), true);
	assert.deepEqual((await readdir(state.root)).filter((name) => name.includes(".quarantine")), []);
});

test("manifest update leaves a foreign symlink at the original path", async (t) => {
	const state = await fixture(t);
	const displaced = join(state.root, "original-manifest.json");

	await assert.rejects(
		writeMigrationManifest(state.path, { ...state.manifest, phase: "rolled-back" }, {
			beforeCommit: async () => {
				await rename(state.path, displaced);
				await symlink(displaced, state.path);
			},
		}),
		/safe regular file|changed|ownership/i,
	);
	assert.equal((await lstat(state.path)).isSymbolicLink(), true);
	assert.deepEqual((await readdir(state.root)).filter((name) => name.includes(".quarantine")), []);
});
