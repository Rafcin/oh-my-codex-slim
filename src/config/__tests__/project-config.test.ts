import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	__setWriteOmcsConfigHooksForTest,
	renderOmcsConfig,
	writeOmcsConfig,
} from "../project-config.js";
import { DEFAULT_OMCS_CONFIG } from "../omcs-config.js";

async function fixture(): Promise<{ root: string; path: string }> {
	const root = await mkdtemp(join(tmpdir(), "omcs-project-config-"));
	return { root, path: join(root, "nested", "omcs.config.json") };
}

describe("ownership-safe OMCS configuration writer", () => {
	it("creates a mode 0644 canonical config, and dry runs byte-for-byte without creating it", async () => {
		const { root, path } = await fixture();
		try {
			const expected = renderOmcsConfig(DEFAULT_OMCS_CONFIG);
			assert.deepEqual(await writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: true }), {
				action: "would-create", path, bytes: expected.byteLength,
			});
			await assert.rejects(lstat(path), { code: "ENOENT" });
			await assert.rejects(lstat(join(root, "nested")), { code: "ENOENT" });
			assert.deepEqual(await writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false }), {
				action: "create", path, bytes: expected.byteLength,
			});
			assert.deepEqual(await readFile(path), expected);
			assert.equal((await lstat(path)).mode & 0o777, 0o644);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("leaves identical bytes unchanged and refuses a different unowned file", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			await writeFile(path, renderOmcsConfig(DEFAULT_OMCS_CONFIG));
			assert.equal((await writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false })).action, "unchanged");
			await writeFile(path, "user-owned bytes\n");
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false }), /refuses|update|owned/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("updates only an existing parseable OMCS file and reports dry-run updates", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			await writeFile(path, '{"version":1,"profile":"fast"}\n');
			const config = { ...DEFAULT_OMCS_CONFIG, profile: "thorough" as const };
			assert.equal((await writeOmcsConfig({ path, config, update: true, dryRun: true })).action, "would-update");
			assert.equal((await writeOmcsConfig({ path, config, update: true, dryRun: false })).action, "update");
			await writeFile(path, "not omcs\n");
			await assert.rejects(writeOmcsConfig({ path, config, update: true, dryRun: false }), /invalid|refuses/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses symlinked files, hardlinked files, and symlinked ancestor directories", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			const target = join(root, "target.json");
			await writeFile(target, renderOmcsConfig(DEFAULT_OMCS_CONFIG));
			await symlink(target, path);
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /symlink|unsafe/i);
			await rm(path);
			await link(target, path);
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /link|unsafe/i);
			await rm(path);
			await symlink(join(root, "nested"), join(root, "linked-parent"));
			await assert.rejects(writeOmcsConfig({ path: join(root, "linked-parent", "config.json"), config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false }), /symlink|unsafe/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("cleans the staging file and restores exact prior bytes after an injected commit failure", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			const before = Buffer.from('{"version":1,"profile":"fast"}\n');
			await writeFile(path, before);
			__setWriteOmcsConfigHooksForTest({ beforeVisibleCommit: async () => { throw new Error("injected commit failure"); } });
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /injected/);
			assert.deepEqual(await readFile(path), before);
			const entries = await (await import("node:fs/promises")).readdir(join(root, "nested"));
			assert.deepEqual(entries.filter((entry) => entry.includes(".omcs-config-") || entry.endsWith(".stage")), []);
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await chmod(join(root, "nested"), 0o755).catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not clobber a user file that appears before a create commit", async () => {
		const { root, path } = await fixture();
		try {
			const userBytes = Buffer.from("user appeared\n");
			__setWriteOmcsConfigHooksForTest({ beforeCommit: async () => { await writeFile(path, userBytes); } });
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false }), /appeared|exists|commit/i);
			assert.deepEqual(await readFile(path), userBytes);
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("quarantines and restores a raced update without replacing the new user bytes", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			await writeFile(path, '{"version":1,"profile":"fast"}\n');
			const userBytes = Buffer.from("user replacement\n");
			__setWriteOmcsConfigHooksForTest({ beforeCommit: async () => { await writeFile(path, userBytes); } });
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /changed|commit/i);
			assert.deepEqual(await readFile(path), userBytes);
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("detects a swapped containing directory in the post-verify pre-open interval and never writes through it", async () => {
		const { root, path } = await fixture();
		try {
			const nested = join(root, "nested");
			const outside = join(root, "outside");
			await mkdir(nested);
			await mkdir(outside);
			__setWriteOmcsConfigHooksForTest({ beforeStageDirectoryOpen: async () => {
				await rename(nested, join(root, "moved-nested"));
				await symlink(outside, nested);
			} });
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false }), /directory|symlink|unsafe/i);
			await assert.rejects(lstat(join(outside, "omcs.config.json")), { code: "ENOENT" });
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("sets mode 0644 even when the process umask is 077", async () => {
		const { root, path } = await fixture();
		const originalUmask = process.umask(0o077);
		try {
			await writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: false, dryRun: false });
			assert.equal((await lstat(path)).mode & 0o777, 0o644);
		} finally {
			process.umask(originalUmask);
			await rm(root, { recursive: true, force: true });
		}
	});

	it("never rolls back a visible commit when a concurrent replacement appears after proof", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			const before = Buffer.from('{"version":1,"profile":"fast"}\n');
			await writeFile(path, before);
			const concurrent = Buffer.from("concurrent user bytes\n");
			__setWriteOmcsConfigHooksForTest({
				afterVisibleCommit: async () => {
					await writeFile(path, concurrent);
					throw new Error("injected cleanup failure");
				},
			});
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /recoverable|injected|commit/i);
			assert.deepEqual(await readFile(path), concurrent);
			const entries = await readdir(join(root, "nested"));
			assert.deepEqual(entries.filter((entry) => entry.endsWith(".tmp")), []);
			assert.ok(entries.some((entry) => entry.endsWith(".quarantine")), "prior bytes must remain recoverable");
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a renamed private stage source before linking and restores the prior public bytes", async () => {
		const { root, path } = await fixture();
		try {
			await mkdir(join(root, "nested"));
			const before = Buffer.from('{"version":1,"profile":"fast"}\n');
			await writeFile(path, before);
			const untrusted = Buffer.from("untrusted stage source\n");
			const untrustedPath = join(root, "untrusted-source.json");
			await writeFile(untrustedPath, untrusted);
			__setWriteOmcsConfigHooksForTest({ beforeStageSourceLink: async (stagePath) => { await rename(untrustedPath, stagePath); } });
			await assert.rejects(writeOmcsConfig({ path, config: DEFAULT_OMCS_CONFIG, update: true, dryRun: false }), /pre-commit|stage|changed|unsafe/i);
			assert.deepEqual(await readFile(path), before);
			assert.doesNotMatch((await readFile(path)).toString(), /untrusted/);
			assert.ok((await readdir(join(root, "nested"))).some((entry) => entry.endsWith(".stage")), "replaced source remains private recovery evidence");
		} finally {
			__setWriteOmcsConfigHooksForTest();
			await rm(root, { recursive: true, force: true });
		}
	});
});
