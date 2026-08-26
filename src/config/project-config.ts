import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, rm, rmdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

import { type OmcsConfig, parseOmcsConfig } from "./omcs-config.js";

const MAX_CONFIG_BYTES = 64 * 1024;

export interface WriteOmcsConfigOptions {
	path: string;
	config: OmcsConfig;
	update: boolean;
	dryRun: boolean;
}

export interface WriteOmcsConfigReport {
	action: "create" | "unchanged" | "update" | "would-create" | "would-update";
	path: string;
	bytes: number;
}

interface WriteHooks {
	beforeStageDirectoryOpen?: () => Promise<void>;
	beforeCommit?: () => Promise<void>;
	beforeVisibleCommit?: () => Promise<void>;
	beforeStageSourceLink?: (stagePath: string) => Promise<void>;
	afterVisibleCommit?: () => Promise<void>;
}

interface Identity { dev: number; ino: number }
interface FileSnapshot extends Identity { bytes: Buffer }
interface DirectoryGuard extends Identity { path: string; handle: FileHandle }
interface StagedFile extends Identity { path: string }
interface PrivateStage { path: string; parent: DirectoryGuard; directory: DirectoryGuard; file?: StagedFile }

let testHooks: WriteHooks | undefined;

/** Test-only fault injection for commit races and recovery boundaries. */
export function __setWriteOmcsConfigHooksForTest(hooks?: WriteHooks): void { testHooks = hooks; }

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
function refuses(message: string): Error { return new Error(`OMCS refuses unsafe configuration write: ${message}`); }
function sameIdentity(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }

/** Renders the stable public version-one configuration schema without hidden metadata. */
export function renderOmcsConfig(config: OmcsConfig): Buffer {
	const bytes = Buffer.from(`${JSON.stringify(config, null, "\t")}\n`, "utf8");
	parseOmcsConfig(bytes, "written");
	return bytes;
}

async function ensureSafeParent(path: string, create: boolean): Promise<string> {
	const parent = dirname(path);
	const root = parse(parent).root;
	let current = root;
	for (const component of relative(root, parent).split(sep).filter(Boolean)) {
		current = resolve(current, component);
		try {
			const state = await lstat(current);
			if (state.isSymbolicLink() && (current === "/var" || current === "/tmp")) continue;
			if (state.isSymbolicLink() || !state.isDirectory()) throw refuses(`unsafe ancestor: ${current}`);
		} catch (error) {
			if (!isMissing(error)) throw error;
			if (!create) continue;
			await mkdir(current, { mode: 0o755 });
			const state = await lstat(current);
			if (state.isSymbolicLink() || !state.isDirectory()) throw refuses(`unsafe created ancestor: ${current}`);
		}
	}
	return parent;
}

async function openDirectoryGuard(path: string, expected?: Identity): Promise<DirectoryGuard> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
	try {
		const descriptor = await handle.stat();
		const named = await lstat(path);
		if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(descriptor, named)
			|| (expected && (!sameIdentity(descriptor, expected) || !sameIdentity(named, expected)))) throw refuses(`containing directory changed: ${path}`);
		return { path, handle, dev: descriptor.dev, ino: descriptor.ino };
	} catch (error) { await handle.close(); throw error; }
}

async function verifyDirectory(guard: DirectoryGuard): Promise<void> {
	const descriptor = await guard.handle.stat();
	const named = await lstat(guard.path);
	if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(descriptor, guard) || !sameIdentity(named, guard)) {
		throw refuses(`containing directory changed: ${guard.path}`);
	}
}

async function snapshotFile(path: string, allowedLinks = 1): Promise<FileSnapshot | null> {
	let handle: FileHandle | undefined;
	try {
		const namedBefore = await lstat(path);
		if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== allowedLinks) throw refuses(`unsafe file: ${path}`);
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = await handle.stat();
		if (!before.isFile() || before.nlink !== allowedLinks || before.size < 0 || before.size > MAX_CONFIG_BYTES || !sameIdentity(before, namedBefore)) throw refuses(`unsafe file: ${path}`);
		const bytes = await handle.readFile();
		const after = await handle.stat();
		const namedAfter = await lstat(path);
		if (bytes.byteLength > MAX_CONFIG_BYTES || !sameIdentity(before, after) || !sameIdentity(after, namedAfter)
			|| namedAfter.isSymbolicLink() || !namedAfter.isFile() || namedAfter.nlink !== allowedLinks) throw refuses(`file changed while reading: ${path}`);
		return { bytes, dev: after.dev, ino: after.ino };
	} catch (error) {
		if (!handle && isMissing(error)) return null;
		throw error;
	} finally { await handle?.close(); }
}

async function verifyPrivateStage(stage: PrivateStage): Promise<void> {
	await verifyDirectory(stage.parent);
	await verifyDirectory(stage.directory);
	await verifyDirectory(stage.parent);
}

async function createPrivateStage(parent: DirectoryGuard, target: string): Promise<PrivateStage> {
	await verifyDirectory(parent);
	const path = join(parent.path, `.${basename(target)}.omcs-${randomUUID()}.stage`);
	await mkdir(path, { mode: 0o700 });
	await chmod(path, 0o700);
	const created = await lstat(path);
	if (created.isSymbolicLink() || !created.isDirectory()) throw refuses(`unsafe staging directory: ${path}`);
	await verifyDirectory(parent);
	await testHooks?.beforeStageDirectoryOpen?.();
	await verifyDirectory(parent);
	const directory = await openDirectoryGuard(path, created);
	const stage = { path, parent, directory };
	await verifyPrivateStage(stage);
	return stage;
}

async function stageFile(stage: PrivateStage, bytes: Buffer): Promise<StagedFile> {
	await verifyPrivateStage(stage);
	const path = join(stage.path, `${randomUUID()}.json`);
	let handle: FileHandle | undefined;
	try {
		handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
		await handle.chmod(0o644);
		await handle.writeFile(bytes);
		await verifyPrivateStage(stage);
		await handle.sync();
		const state = await handle.stat();
		if (!state.isFile() || state.nlink !== 1) throw refuses(`unsafe staged file: ${path}`);
		await handle.close();
		handle = undefined;
		await verifyPrivateStage(stage);
		return { path, dev: state.dev, ino: state.ino };
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(path, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function syncDirectory(guard: DirectoryGuard): Promise<void> {
	await verifyDirectory(guard);
	await guard.handle.sync();
	await verifyDirectory(guard);
}

async function moveToQuarantine(guard: DirectoryGuard, path: string): Promise<string> {
	const quarantine = join(guard.path, `.${basename(path)}.omcs-${randomUUID()}.quarantine`);
	await verifyDirectory(guard);
	await rename(path, quarantine);
	await verifyDirectory(guard);
	await syncDirectory(guard);
	return quarantine;
}

async function removePath(guard: DirectoryGuard, path: string): Promise<void> {
	await verifyDirectory(guard);
	await rm(path, { force: true });
	await verifyDirectory(guard);
}

async function restorePriorNoClobber(guard: DirectoryGuard, target: string, quarantine: string): Promise<void> {
	await verifyDirectory(guard);
	await link(quarantine, target);
	await verifyDirectory(guard);
	await removePath(guard, quarantine);
	await syncDirectory(guard);
}

async function commitStagedNoClobber(stage: PrivateStage, target: string, desired: Buffer): Promise<void> {
	if (!stage.file) throw new Error("OMCS staged source is missing");
	await verifyPrivateStage(stage);
	let source = await snapshotFile(stage.file.path);
	if (!source || !source.bytes.equals(desired) || !sameIdentity(source, stage.file)) throw refuses("staged source changed before commit");
	await testHooks?.beforeStageSourceLink?.(stage.file.path);
	await verifyPrivateStage(stage);
	source = await snapshotFile(stage.file.path);
	if (!source || !source.bytes.equals(desired) || !sameIdentity(source, stage.file)) throw refuses("staged source changed before commit");
	await link(stage.file.path, target);
	await verifyPrivateStage(stage);
	const targetSnapshot = await snapshotFile(target, 2);
	if (!targetSnapshot || !targetSnapshot.bytes.equals(desired) || !sameIdentity(targetSnapshot, stage.file)) throw refuses("target changed during commit");
}

async function cleanupPrivateStage(stage: PrivateStage, target: string, desired: Buffer, visible: boolean): Promise<void> {
	if (!stage.file) return;
	await verifyPrivateStage(stage);
	const source = await snapshotFile(stage.file.path, 2);
	const targetSnapshot = await snapshotFile(target, 2);
	if (!source || !targetSnapshot || !source.bytes.equals(desired) || !targetSnapshot.bytes.equals(desired)
		|| !sameIdentity(source, stage.file) || !sameIdentity(targetSnapshot, stage.file)) {
		if (visible) throw new Error("OMCS visible commit needs recovery; staged source or target changed");
		throw refuses("staged source changed before commit");
	}
	await removePath(stage.directory, stage.file.path);
	stage.file = undefined;
	await verifyPrivateStage(stage);
	const finalTarget = await snapshotFile(target);
	if (!finalTarget || !finalTarget.bytes.equals(desired)) throw new Error("OMCS committed target changed during cleanup");
	await stage.directory.handle.close();
	const named = await lstat(stage.path);
	if (named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(named, stage.directory)) throw refuses("staging directory changed during cleanup");
	await rmdir(stage.path);
	await verifyDirectory(stage.parent);
}

async function cleanupAbortedStage(stage: PrivateStage): Promise<void> {
	await verifyPrivateStage(stage);
	if (stage.file) {
		const named = await lstat(stage.file.path);
		if (named.isSymbolicLink() || !named.isFile() || !sameIdentity(named, stage.file)) {
			throw new Error("OMCS preserves a changed private staging source for recovery");
		}
		await removePath(stage.directory, stage.file.path);
		stage.file = undefined;
	}
	await verifyPrivateStage(stage);
	await stage.directory.handle.close();
	const named = await lstat(stage.path);
	if (named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(named, stage.directory)) throw refuses("staging directory changed during cleanup");
	await rmdir(stage.path);
	await verifyDirectory(stage.parent);
}

async function closeStage(stage: PrivateStage | undefined): Promise<void> {
	await stage?.directory.handle.close().catch(() => undefined);
}

/**
 * Creates a new config or explicitly replaces a parseable prior OMCS config.
 * Node's public fs API has no dirfd-relative open/link/rename, so all pathname
 * operations are confined to a randomized 0700 sibling staging directory and
 * guarded by held directory descriptors plus device/inode checks. A same-user
 * adversary with filesystem mutation rights can still race a pathname between
 * those checks; this runtime cannot provide openat-style capability semantics.
 */
export async function writeOmcsConfig(options: WriteOmcsConfigOptions): Promise<WriteOmcsConfigReport> {
	const path = resolve(options.path);
	const bytes = renderOmcsConfig(options.config);
	const directory = await ensureSafeParent(path, !options.dryRun);
	const existing = await snapshotFile(path);
	if (existing && existing.bytes.equals(bytes)) return { action: "unchanged", path, bytes: bytes.byteLength };
	if (existing && !options.update) throw new Error("OMCS refuses to replace an existing user-owned configuration without --update");
	if (existing) parseOmcsConfig(existing.bytes, "existing");
	const action = existing ? "update" : "create";
	if (options.dryRun) return { action: `would-${action}` as "would-create" | "would-update", path, bytes: bytes.byteLength };

	let parent: DirectoryGuard | undefined;
	let stage: PrivateStage | undefined;
	let priorQuarantine: string | undefined;
	let visible = false;
	try {
		parent = await openDirectoryGuard(directory);
		stage = await createPrivateStage(parent, path);
		stage.file = await stageFile(stage, bytes);
		await testHooks?.beforeCommit?.();
		await verifyDirectory(parent);
		if (existing) {
			priorQuarantine = await moveToQuarantine(parent, path);
			const moved = await snapshotFile(priorQuarantine);
			if (!moved || !moved.bytes.equals(existing.bytes) || !sameIdentity(moved, existing)) {
				await restorePriorNoClobber(parent, path, priorQuarantine);
				priorQuarantine = undefined;
				throw new Error("OMCS configuration changed before commit");
			}
		} else if (await snapshotFile(path)) throw new Error("OMCS configuration appeared before commit");
		await testHooks?.beforeVisibleCommit?.();
		await commitStagedNoClobber(stage, path, bytes);
		visible = true;
		await testHooks?.afterVisibleCommit?.();
		await cleanupPrivateStage(stage, path, bytes, true);
		await syncDirectory(parent);
		if (priorQuarantine) {
			// All fallible durability work completed; deletion is intentionally last.
			await removePath(parent, priorQuarantine);
			priorQuarantine = undefined;
		}
		return { action, path, bytes: bytes.byteLength };
	} catch (error) {
		if (visible) {
			throw new Error("OMCS configuration committed; cleanup/recovery is required", { cause: error });
		}
		const recoveryErrors: unknown[] = [];
		if (priorQuarantine && parent) {
			try {
				await restorePriorNoClobber(parent, path, priorQuarantine);
				priorQuarantine = undefined;
			} catch (recoveryError) { recoveryErrors.push(recoveryError); }
		}
		if (stage) {
			try { await cleanupAbortedStage(stage); } catch (recoveryError) { recoveryErrors.push(recoveryError); }
		}
		if (recoveryErrors.length > 0) throw new AggregateError([error, ...recoveryErrors], "OMCS configuration pre-commit recovery failed");
		throw error;
	} finally {
		await closeStage(stage);
		await parent?.handle.close();
	}
}
