import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import { astSearch } from "../ast.js";
import { astReplace } from "../ast.js";
import { buildCodeMap } from "../codemap.js";
import { cloneDependency } from "../clonedeps.js";
import { runLanguageServerOperation } from "../lsp.js";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(path);
	return path;
}

async function gitFixture(root: string, name = "fixture-source"): Promise<{ source: string; revision: string }> {
	const source = join(root, name);
	await mkdir(source);
	await run("git", ["init", "-b", "main"], { cwd: source });
	await run("git", ["config", "user.email", "fixture@example.invalid"], { cwd: source });
	await run("git", ["config", "user.name", "Fixture Author"], { cwd: source });
	await writeFile(join(source, "README.md"), "fixture\n");
	await run("git", ["add", "README.md"], { cwd: source });
	await run("git", ["commit", "-m", "fixture"], { cwd: source });
	const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: source });
	return { source, revision: stdout.trim() };
}

afterEach(async () => {
	for (const path of temporaryDirectories.splice(0)) {
		async function makeWritable(target: string): Promise<void> {
			const info = await lstat(target);
			if (info.isDirectory()) {
				await chmod(target, 0o700);
				for (const child of await readdir(target)) await makeWritable(join(target, child));
			} else if (!info.isSymbolicLink()) {
				await chmod(target, 0o600);
			}
		}
		await makeWritable(path).catch(() => undefined);
		await rm(path, { recursive: true, force: true });
	}
});

describe("project path containment", () => {
	it("rejects traversal for clone destinations", async () => {
		const root = await temporaryDirectory("omcs-clone-traversal-");
		const result = await cloneDependency({ root, url: "https://example.com/repo.git", destination: "../escape" });
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "path-outside-project");
	});

	it("rejects symlink escapes for every path-taking read operation", async () => {
		const root = await temporaryDirectory("omcs-path-root-");
		const outside = await temporaryDirectory("omcs-path-outside-");
		await writeFile(join(outside, "secret.ts"), "export const secret = true;\n");
		await symlink(outside, join(root, "escape"));

		for (const result of [
			await astSearch({ root, path: "escape/secret.ts", pattern: "secret", language: "typescript" }),
			await buildCodeMap({ root, path: "escape" }),
			await runLanguageServerOperation({ root, operation: "symbols", path: "escape/secret.ts" }, {}),
		]) {
			assert.equal(result.ok, false);
			assert.equal(result.error?.code, "path-outside-project");
		}
	});

	it("rejects hard-linked target and local-source files", async () => {
		const root = await temporaryDirectory("omcs-hardlinks-");
		await writeFile(join(root, "target.ts"), "const value = 1;\n");
		await link(join(root, "target.ts"), join(root, "target-copy.ts"));
		const ast = await astSearch({ root, path: "target.ts", pattern: "value", language: "typescript" });
		assert.equal(ast.ok, false);
		assert.equal(ast.error?.code, "ownership-conflict");

		const { source } = await gitFixture(root, "hardlink-source");
		await link(join(source, "README.md"), join(source, "README-copy.md"));
		const clone = await cloneDependency({ root, url: source, destination: "hardlink", allowLocalSource: true });
		assert.equal(clone.ok, false);
		assert.equal(clone.error?.code, "ownership-conflict");
	});

	it("fails closed when an AST parent is swapped before commit", async () => {
		const root = await temporaryDirectory("omcs-ast-parent-race-");
		const sourceDirectory = join(root, "src");
		await mkdir(sourceDirectory);
		await writeFile(join(sourceDirectory, "target.ts"), "const oldName = 1;\n");
		const result = await astReplace(
			{ root, path: "src/target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				beforeCommit: async () => {
					await rename(sourceDirectory, join(root, "displaced"));
					await mkdir(sourceDirectory);
					await writeFile(join(sourceDirectory, "target.ts"), "user replacement\n");
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		assert.equal(await readFile(join(sourceDirectory, "target.ts"), "utf8"), "user replacement\n");
		assert.equal(await readFile(join(root, "displaced", "target.ts"), "utf8"), "const oldName = 1;\n");
	});

	it("rolls back the AST backup when target commit fails", async () => {
		const root = await temporaryDirectory("omcs-ast-rollback-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{ commitTarget: async () => { throw new Error("injected target commit failure"); } },
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(join(root, "target.ts"), "utf8"), "const oldName = 1;\n");
		const backups = join(root, ".omcs", "backups", "ast");
		await assert.rejects(readdir(backups), /ENOENT/);
	});

	it("restores exact AST bytes after a post-commit failure", async () => {
		const root = await temporaryDirectory("omcs-ast-post-commit-");
		const original = "const oldName = 1;\n";
		await writeFile(join(root, "target.ts"), original);
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{ afterTargetCommit: async () => { throw new Error("injected post-commit failure"); } },
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(join(root, "target.ts"), "utf8"), original);
		await assert.rejects(readdir(join(root, ".omcs", "backups", "ast")), /ENOENT/);
	});

	it("recovers when injected AST seams throw after creating owned state", async () => {
		for (const phase of ["createBackup", "commitTarget"] as const) {
			const root = await temporaryDirectory(`omcs-ast-partial-${phase}-`);
			const original = "const oldName = 1;\n";
			await writeFile(join(root, "target.ts"), original);
			const dependencies = phase === "createBackup"
				? { createBackup: async (path: string, bytes: Buffer) => { await writeFile(path, bytes, { flag: "wx" }); throw new Error("injected after backup"); } }
				: { commitTarget: async (from: string, to: string) => { await rename(from, to); throw new Error("injected after target commit"); } };
			const result = await astReplace(
				{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
				dependencies,
			);
			assert.equal(result.ok, false, phase);
			assert.equal(await readFile(join(root, "target.ts"), "utf8"), original);
			await assert.rejects(readdir(join(root, ".omcs", "backups", "ast")), /ENOENT/);
		}
	});

	it("surfaces rollback cleanup failures without silently losing recovery state", async () => {
		const root = await temporaryDirectory("omcs-ast-aggregate-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				commitTarget: async () => { throw new Error("injected target commit failure"); },
				removePath: async (path) => {
					await rm(path, { force: true });
					if (path.includes(`${join("backups", "ast")}`)) throw new Error("injected cleanup failure");
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "rollback-failed");
		assert.equal(await readFile(join(root, "target.ts"), "utf8"), "const oldName = 1;\n");
	});

	it("rejects and preserves an equal-content AST target replaced immediately after rename", async () => {
		const root = await temporaryDirectory("omcs-ast-post-rename-swap-");
		const target = join(root, "target.ts");
		await writeFile(target, "const oldName = 1;\n");
		let replacementInode: number | undefined;
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				afterTargetRename: async (committedPath) => {
					await rename(committedPath, `${committedPath}.displaced`);
					const replacement = `${committedPath}.replacement`;
					await writeFile(replacement, "const newName = 1;\n");
					await rename(replacement, committedPath);
					replacementInode = (await lstat(committedPath)).ino;
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		assert.equal((await lstat(target)).ino, replacementInode);
		assert.equal(await readFile(target, "utf8"), "const newName = 1;\n");
	});

	it("cleans every partially acquired AST lock so a future mutation can proceed", async () => {
		for (const phase of ["write", "sync", "stat", "close"] as const) {
			const root = await temporaryDirectory(`omcs-ast-lock-${phase}-`);
			await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
			const lockIo = {
				write: async (handle: FileHandle, bytes: string) => { if (phase === "write") throw new Error("injected lock write"); await handle.writeFile(bytes); },
				sync: async (handle: FileHandle) => { if (phase === "sync") throw new Error("injected lock sync"); await handle.sync(); },
				stat: async (handle: FileHandle) => { if (phase === "stat") throw new Error("injected lock stat"); return await handle.stat(); },
				close: async (handle: FileHandle) => { await handle.close(); if (phase === "close") throw new Error("injected lock close"); },
			};
			const failed = await astReplace(
				{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
				{ lockIo },
			);
			assert.equal(failed.ok, false, phase);
			const retried = await astReplace(
				{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			);
			assert.equal(retried.ok, true, `${phase}: ${JSON.stringify(retried)}`);
		}
	});

	it("leaves a concurrently replaced unknown AST lock untouched", async () => {
		for (const phase of ["write", "sync", "stat", "close"] as const) {
			const root = await temporaryDirectory(`omcs-ast-lock-replacement-${phase}-`);
			await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
			let unknownLock = "";
			const result = await astReplace(
				{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
				{
					lockIo: {
						write: async (handle, bytes) => { if (phase === "write") throw new Error("injected"); await handle.writeFile(bytes); },
						sync: async (handle) => { if (phase === "sync") throw new Error("injected"); await handle.sync(); },
						stat: async (handle) => { if (phase === "stat") throw new Error("injected"); return await handle.stat(); },
						close: async (handle) => { if (phase === "close") throw new Error("injected"); await handle.close(); },
					},
					afterLockFailure: async (path) => {
						unknownLock = path;
						await rm(path);
						await writeFile(path, "unknown owner\n", { flag: "wx" });
					},
				},
			);
			assert.equal(result.ok, false, phase);
			assert.equal(await readFile(unknownLock, "utf8"), "unknown owner\n");
		}
	});

	it("unlinks its exact partially acquired lock even if another hard link appears", async () => {
		const root = await temporaryDirectory("omcs-ast-lock-hardlink-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		let retainedLink = "";
		const failed = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				lockIo: { write: async () => { throw new Error("injected lock write"); } },
				afterLockFailure: async (path) => {
					retainedLink = `${path}.retained`;
					await link(path, retainedLink);
				},
			},
		);
		assert.equal(failed.ok, false);
		assert.equal(await readFile(retainedLink, "utf8"), "");
		const retried = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
		);
		assert.equal(retried.ok, true, JSON.stringify(retried));
	});

	it("reports partial-lock durability cleanup failures as rollback-failed", async () => {
		const root = await temporaryDirectory("omcs-ast-lock-cleanup-error-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		let lockPath = "";
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				lockIo: {
					write: async () => { throw new Error("injected lock write"); },
					syncParent: async (path) => { lockPath = path; throw new Error("injected parent fsync"); },
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "rollback-failed");
		await assert.rejects(lstat(lockPath), /ENOENT/);
	});

	it("cleans an AST lock when the first post-open identity stat fails and closes the descriptor", async () => {
		const root = await temporaryDirectory("omcs-ast-lock-initial-stat-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		let openedHandle: FileHandle | undefined;
		const failed = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{ lockIo: { initialStat: async (handle) => { openedHandle = handle; throw new Error("injected initial stat"); } } },
		);
		assert.equal(failed.ok, false);
		assert.equal(openedHandle?.fd, -1);
		const retried = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
		);
		assert.equal(retried.ok, true, JSON.stringify(retried));
	});

	it("preserves an unknown AST lock replacement after the first identity stat fails", async () => {
		const root = await temporaryDirectory("omcs-ast-lock-initial-stat-replacement-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		let unknownLock = "";
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				lockIo: { initialStat: async () => { throw new Error("injected initial stat"); } },
				afterLockFailure: async (path) => {
					unknownLock = path;
					await rm(path);
					await writeFile(path, "unknown owner\n", { flag: "wx" });
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(unknownLock, "utf8"), "unknown owner\n");
	});

	it("maps unprovable first-stat lock cleanup to rollback-failed", async () => {
		const root = await temporaryDirectory("omcs-ast-lock-initial-stat-cleanup-");
		await writeFile(join(root, "target.ts"), "const oldName = 1;\n");
		let openedHandle: FileHandle | undefined;
		const result = await astReplace(
			{ root, path: "target.ts", pattern: "oldName", replacement: "newName", language: "typescript", dryRun: false },
			{
				lockIo: {
					initialStat: async (handle) => { openedHandle = handle; throw new Error("injected initial stat"); },
					recoverStat: async () => { throw new Error("injected recovery stat"); },
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "rollback-failed");
		assert.equal(openedHandle?.fd, -1);
	});
});

describe("offline dependency clone", () => {
	it("clones a local fixture at an immutable revision, records exact provenance, and makes it read-only", async () => {
		const root = await temporaryDirectory("omcs-clone-root-");
		const { source, revision } = await gitFixture(root);

		const result = await cloneDependency({
			root,
			url: source,
			destination: "fixture",
			revision: "HEAD",
			allowLocalSource: true,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.deepEqual(result.data, {
			path: ".omcs/clonedeps/repos/fixture/repository",
			url: source,
			revision,
		});
		const manifest = JSON.parse(await readFile(join(root, ".omcs", "clonedeps", "manifest.json"), "utf8")) as {
			repositories: Array<{ path: string; url: string; revision: string }>;
		};
		assert.deepEqual(manifest.repositories, [{ path: ".omcs/clonedeps/repos/fixture/repository", url: source, revision }]);
		assert.equal((await lstat(join(root, ".omcs", "clonedeps", "repos", "fixture", "repository", "README.md"))).mode & 0o222, 0);
	});

	it("passes no provider or Git injection environment to child processes and disables local hardlinks", async () => {
		const root = await temporaryDirectory("omcs-clone-env-");
		const { source } = await gitFixture(root);
		const observed: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				run: async (file, args, options) => {
					observed.push({ args, env: options.env });
					return await run(file, [...args], options);
				},
				parentEnvironment: {
					PATH: process.env.PATH,
					PROVIDER_API_KEY_SENTINEL: "must-not-pass",
					GIT_CONFIG_COUNT: "1",
					GIT_CONFIG_KEY_0: "core.hooksPath",
					GIT_CONFIG_VALUE_0: "/tmp/evil",
					GIT_EXEC_PATH: "/tmp/evil",
					GIT_TEMPLATE_DIR: "/tmp/evil",
					GIT_SSH_COMMAND: "evil",
					GIT_ASKPASS: "/tmp/evil",
				},
			},
		);
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.ok(observed[0]?.args.includes("--no-hardlinks"));
		for (const call of observed) {
			assert.equal(call.env?.PROVIDER_API_KEY_SENTINEL, undefined);
			assert.equal(call.env?.GIT_CONFIG_COUNT, undefined);
			assert.equal(call.env?.GIT_EXEC_PATH, undefined);
			assert.equal(call.env?.GIT_TEMPLATE_DIR, undefined);
			assert.equal(call.env?.GIT_SSH_COMMAND, undefined);
			assert.equal(call.env?.GIT_ASKPASS, undefined);
			assert.deepEqual(Object.keys(call.env ?? {}).sort(), ["GIT_ALLOW_PROTOCOL", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT", "LANG", "LC_ALL", "PATH"].sort());
		}
	});

	it("fails closed on destination and manifest swaps while holding clone ownership", async () => {
		const root = await temporaryDirectory("omcs-clone-races-");
		const { source } = await gitFixture(root);
		const destinationResult = await cloneDependency(
			{ root, url: source, destination: "destination-race", allowLocalSource: true },
			{
				beforeCommit: async () => {
					const raced = join(root, ".omcs", "clonedeps", "repos", "destination-race");
					await mkdir(raced);
					await writeFile(join(raced, "owner.txt"), "other owner\n");
				},
			},
		);
		assert.equal(destinationResult.ok, false);
		assert.equal(destinationResult.error?.code, "ownership-conflict");
		assert.equal(await readFile(join(root, ".omcs", "clonedeps", "repos", "destination-race", "owner.txt"), "utf8"), "other owner\n");

		const manifestPath = join(root, ".omcs", "clonedeps", "manifest.json");
		const initial = '{"owner":"oh-my-codex-slim","schemaVersion":1,"repositories":[]}\n';
		await writeFile(manifestPath, initial);
		const swapped = '{"owner":"oh-my-codex-slim","schemaVersion":1,"repositories":[{"path":"other","url":"https://example.invalid/repo.git","revision":"0123456789012345678901234567890123456789"}]}\n';
		const manifestResult = await cloneDependency(
			{ root, url: source, destination: "manifest-race", allowLocalSource: true },
			{
				beforeCommit: async () => {
					const replacement = `${manifestPath}.replacement`;
					await writeFile(replacement, swapped);
					await rename(replacement, manifestPath);
				},
			},
		);
		assert.equal(manifestResult.ok, false);
		assert.equal(manifestResult.error?.code, "ownership-conflict");
		assert.equal(await readFile(manifestPath, "utf8"), swapped);
	});

	it("rolls back every injected clone commit phase without partial ownership", async () => {
		for (const phase of ["reserveDestination", "moveClone", "commitManifest"] as const) {
			const root = await temporaryDirectory(`omcs-clone-rollback-${phase}-`);
			const { source } = await gitFixture(root);
			const dependencies = {
				[phase]: async () => { throw new Error(`injected ${phase}`); },
			};
			const result = await cloneDependency(
				{ root, url: source, destination: "fixture", allowLocalSource: true },
				dependencies,
			);
			assert.equal(result.ok, false, phase);
			await assert.rejects(lstat(join(root, ".omcs", "clonedeps", "repos", "fixture")), /ENOENT/);
			await assert.rejects(readFile(join(root, ".omcs", "clonedeps", "manifest.json")), /ENOENT/);
			await assert.rejects(readdir(join(root, ".omcs", "clonedeps")), /ENOENT/);
		}
	});

	it("preserves an existing manifest when clone backup creation fails", async () => {
		const root = await temporaryDirectory("omcs-clone-backup-failure-");
		const { source } = await gitFixture(root);
		const metadata = join(root, ".omcs", "clonedeps");
		await mkdir(join(metadata, "repos"), { recursive: true });
		const original = '{"owner":"oh-my-codex-slim","schemaVersion":1,"repositories":[]}\n';
		await writeFile(join(metadata, "manifest.json"), original);
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{ createBackup: async (path, bytes) => { await writeFile(path, bytes, { flag: "wx" }); throw new Error("injected backup failure"); } },
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(join(metadata, "manifest.json"), "utf8"), original);
		await assert.rejects(lstat(join(metadata, "repos", "fixture")), /ENOENT/);
		assert.deepEqual((await readdir(metadata)).sort(), ["manifest.json", "repos"]);
	});

	it("recovers when injected clone seams throw after moving owned state", async () => {
		for (const phase of ["moveClone", "commitManifest"] as const) {
			const root = await temporaryDirectory(`omcs-clone-partial-${phase}-`);
			const { source } = await gitFixture(root);
			const dependencies = phase === "moveClone"
				? { moveClone: async (from: string, to: string) => { await rename(from, to); throw new Error("injected after move"); } }
				: { commitManifest: async (from: string, to: string) => { await rename(from, to); throw new Error("injected after manifest commit"); } };
			const result = await cloneDependency(
				{ root, url: source, destination: "fixture", allowLocalSource: true },
				dependencies,
			);
			assert.equal(result.ok, false, phase);
			await assert.rejects(lstat(join(root, ".omcs", "clonedeps", "repos", "fixture")), /ENOENT/);
			await assert.rejects(readFile(join(root, ".omcs", "clonedeps", "manifest.json")), /ENOENT/);
			await assert.rejects(readdir(join(root, ".omcs", "clonedeps")), /ENOENT/);
		}
	});

	it("rejects and preserves a repository replaced immediately after clone move", async () => {
		const root = await temporaryDirectory("omcs-clone-post-move-swap-");
		const { source } = await gitFixture(root);
		let replacementInode: number | undefined;
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				afterRepositoryMove: async (repository) => {
					await rename(repository, `${repository}.displaced`);
					await cp(`${repository}.displaced`, repository, { recursive: true, preserveTimestamps: true });
					replacementInode = (await lstat(repository)).ino;
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		const repository = join(root, ".omcs", "clonedeps", "repos", "fixture", "repository");
		assert.equal((await lstat(repository)).ino, replacementInode);
		assert.equal(await readFile(join(repository, "README.md"), "utf8"), "fixture\n");
	});

	it("rejects and preserves an equal-content manifest replaced immediately after commit", async () => {
		const root = await temporaryDirectory("omcs-clone-post-manifest-swap-");
		const { source } = await gitFixture(root);
		let replacementInode: number | undefined;
		let replacementBytes = "";
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				afterManifestCommit: async (manifest) => {
					replacementBytes = await readFile(manifest, "utf8");
					await rename(manifest, `${manifest}.displaced`);
					const replacement = `${manifest}.replacement`;
					await writeFile(replacement, replacementBytes);
					await rename(replacement, manifest);
					replacementInode = (await lstat(manifest)).ino;
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		const manifest = join(root, ".omcs", "clonedeps", "manifest.json");
		assert.equal((await lstat(manifest)).ino, replacementInode);
		assert.equal(await readFile(manifest, "utf8"), replacementBytes);
	});

	it("cleans every partially acquired clone lock so a future clone can proceed", async () => {
		for (const phase of ["write", "sync", "stat", "close"] as const) {
			const root = await temporaryDirectory(`omcs-clone-lock-${phase}-`);
			const { source } = await gitFixture(root);
			const lockIo = {
				write: async (handle: FileHandle, bytes: string) => { if (phase === "write") throw new Error("injected lock write"); await handle.writeFile(bytes); },
				sync: async (handle: FileHandle) => { if (phase === "sync") throw new Error("injected lock sync"); await handle.sync(); },
				stat: async (handle: FileHandle) => { if (phase === "stat") throw new Error("injected lock stat"); return await handle.stat(); },
				close: async (handle: FileHandle) => { await handle.close(); if (phase === "close") throw new Error("injected lock close"); },
			};
			const failed = await cloneDependency(
				{ root, url: source, destination: "fixture", allowLocalSource: true },
				{ lockIo },
			);
			assert.equal(failed.ok, false, phase);
			const retried = await cloneDependency({ root, url: source, destination: "fixture", allowLocalSource: true });
			assert.equal(retried.ok, true, `${phase}: ${JSON.stringify(retried)}`);
		}
	});

	it("leaves a concurrently replaced unknown clone lock untouched", async () => {
		for (const phase of ["write", "sync", "stat", "close"] as const) {
			const root = await temporaryDirectory(`omcs-clone-lock-replacement-${phase}-`);
			const { source } = await gitFixture(root);
			let unknownLock = "";
			const result = await cloneDependency(
				{ root, url: source, destination: "fixture", allowLocalSource: true },
				{
					lockIo: {
						write: async (handle, bytes) => { if (phase === "write") throw new Error("injected"); await handle.writeFile(bytes); },
						sync: async (handle) => { if (phase === "sync") throw new Error("injected"); await handle.sync(); },
						stat: async (handle) => { if (phase === "stat") throw new Error("injected"); return await handle.stat(); },
						close: async (handle) => { if (phase === "close") throw new Error("injected"); await handle.close(); },
					},
					afterLockFailure: async (path) => {
						unknownLock = path;
						await rm(path);
						await writeFile(path, "unknown owner\n", { flag: "wx" });
					},
				},
			);
			assert.equal(result.ok, false, phase);
			assert.equal(await readFile(unknownLock, "utf8"), "unknown owner\n");
		}
	});

	it("cleans a clone lock when the first post-open identity stat fails and closes the descriptor", async () => {
		const root = await temporaryDirectory("omcs-clone-lock-initial-stat-");
		const { source } = await gitFixture(root);
		let openedHandle: FileHandle | undefined;
		const failed = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{ lockIo: { initialStat: async (handle) => { openedHandle = handle; throw new Error("injected initial stat"); } } },
		);
		assert.equal(failed.ok, false);
		assert.equal(openedHandle?.fd, -1);
		const retried = await cloneDependency({ root, url: source, destination: "fixture", allowLocalSource: true });
		assert.equal(retried.ok, true, JSON.stringify(retried));
	});

	it("preserves an unknown clone lock replacement after the first identity stat fails", async () => {
		const root = await temporaryDirectory("omcs-clone-lock-initial-stat-replacement-");
		const { source } = await gitFixture(root);
		let unknownLock = "";
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				lockIo: { initialStat: async () => { throw new Error("injected initial stat"); } },
				afterLockFailure: async (path) => {
					unknownLock = path;
					await rm(path);
					await writeFile(path, "unknown owner\n", { flag: "wx" });
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(unknownLock, "utf8"), "unknown owner\n");
	});

	it("maps unprovable clone first-stat lock cleanup to rollback-failed", async () => {
		const root = await temporaryDirectory("omcs-clone-lock-initial-stat-cleanup-");
		const { source } = await gitFixture(root);
		let openedHandle: FileHandle | undefined;
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				lockIo: {
					initialStat: async (handle) => { openedHandle = handle; throw new Error("injected initial stat"); },
					recoverStat: async () => { throw new Error("injected recovery stat"); },
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "rollback-failed");
		assert.equal(openedHandle?.fd, -1);
	});

	it("rolls back a new manifest when hard-link commit fails before staged unlink", async () => {
		const root = await temporaryDirectory("omcs-clone-manifest-hardlink-partial-");
		const { source } = await gitFixture(root);
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				commitManifest: async (staged, target) => {
					await link(staged, target);
					throw new Error("injected before staged unlink");
				},
			},
		);
		assert.equal(result.ok, false);
		await assert.rejects(lstat(join(root, ".omcs", "clonedeps", "manifest.json")), /ENOENT/);
		await assert.rejects(lstat(join(root, ".omcs", "clonedeps", "repos", "fixture")), /ENOENT/);
		await assert.rejects(readdir(join(root, ".omcs", "clonedeps")), /ENOENT/);
	});

	it("preserves an unknown manifest replacement during a partial hard-link commit", async () => {
		const root = await temporaryDirectory("omcs-clone-manifest-hardlink-unknown-");
		const { source } = await gitFixture(root);
		const unknown = "unknown owner\n";
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				commitManifest: async (staged, target) => {
					await link(staged, target);
					await rm(target);
					await writeFile(target, unknown, { flag: "wx" });
					throw new Error("injected unknown replacement");
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(await readFile(join(root, ".omcs", "clonedeps", "manifest.json"), "utf8"), unknown);
	});

	it("preserves a mode-mutated adopted manifest instead of restoring over it", async () => {
		const root = await temporaryDirectory("omcs-clone-manifest-mode-race-");
		const { source } = await gitFixture(root);
		const metadata = join(root, ".omcs", "clonedeps");
		await mkdir(join(metadata, "repos"), { recursive: true });
		const original = '{"owner":"oh-my-codex-slim","schemaVersion":1,"repositories":[]}\n';
		const manifest = join(metadata, "manifest.json");
		await writeFile(manifest, original);
		const result = await cloneDependency(
			{ root, url: source, destination: "fixture", allowLocalSource: true },
			{
				afterManifestAdoption: async (path) => {
					await chmod(path, 0o640);
					throw new Error("injected after manifest adoption");
				},
			},
		);
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "rollback-failed");
		assert.notEqual(await readFile(manifest, "utf8"), original);
		assert.equal((await lstat(manifest)).mode & 0o777, 0o640);
	});

	it("preserves an unknown exclusive clone lock", async () => {
		const root = await temporaryDirectory("omcs-clone-lock-");
		const { source } = await gitFixture(root);
		const metadata = join(root, ".omcs", "clonedeps");
		await mkdir(join(metadata, "repos"), { recursive: true });
		await writeFile(join(metadata, ".lock"), "other owner\n");
		const result = await cloneDependency({ root, url: source, destination: "fixture", allowLocalSource: true });
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		assert.equal(await readFile(join(metadata, ".lock"), "utf8"), "other owner\n");
	});

	it("rejects HTTPS credentials and local sources unless fixture mode is explicit", async () => {
		const root = await temporaryDirectory("omcs-clone-sources-");
		const embedded = await cloneDependency({ root, url: "https://user:secret@example.com/repo.git", destination: "bad" });
		assert.equal(embedded.ok, false);
		assert.equal(embedded.error?.code, "invalid-source");
		const queryCredential = await cloneDependency({ root, url: "https://example.com/repo.git?token=secret", destination: "query" });
		assert.equal(queryCredential.ok, false);
		assert.equal(queryCredential.error?.code, "invalid-source");

		const local = await cloneDependency({ root, url: root, destination: "local" });
		assert.equal(local.ok, false);
		assert.equal(local.error?.code, "invalid-source");
	});

	it("preserves an unknown valid-looking manifest instead of claiming ownership", async () => {
		const root = await temporaryDirectory("omcs-clone-manifest-owner-");
		const metadata = join(root, ".omcs", "clonedeps");
		await mkdir(metadata, { recursive: true });
		const original = '{"repositories":[]}\n';
		await writeFile(join(metadata, "manifest.json"), original);

		const result = await cloneDependency({ root, url: "https://example.com/repo.git", destination: "blocked" });
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		assert.equal(await readFile(join(metadata, "manifest.json"), "utf8"), original);
	});

	it("preserves an unknown existing destination on ownership conflict", async () => {
		const root = await temporaryDirectory("omcs-clone-conflict-");
		const destination = join(root, ".omcs", "clonedeps", "repos", "existing");
		await mkdir(destination, { recursive: true });
		await writeFile(join(destination, "owner.txt"), "user-owned\n");

		const result = await cloneDependency({
			root,
			url: "https://example.com/repo.git",
			destination: "existing",
		});
		assert.equal(result.ok, false);
		assert.equal(result.error?.code, "ownership-conflict");
		assert.equal(await readFile(join(destination, "owner.txt"), "utf8"), "user-owned\n");
	});
});
