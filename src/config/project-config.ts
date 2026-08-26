import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
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
	beforeStage?: () => Promise<void>;
	beforeCommit?: () => Promise<void>;
	afterCommit?: () => Promise<void>;
	beforeRestore?: () => Promise<void>;
}

interface FileSnapshot {
	bytes: Buffer;
	dev: number;
	ino: number;
}

interface DirectoryGuard {
	path: string;
	handle: FileHandle;
	dev: number;
	ino: number;
}

interface StagedFile {
	path: string;
	dev: number;
	ino: number;
}

let testHooks: WriteHooks | undefined;

/** Test-only fault injection for commit races and rollback recovery. */
export function __setWriteOmcsConfigHooksForTest(hooks?: WriteHooks): void {
	testHooks = hooks;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

function refuses(message: string): Error {
	return new Error(`OMCS refuses unsafe configuration write: ${message}`);
}

function sameIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

/** Renders the stable public version-one configuration schema without hidden metadata. */
export function renderOmcsConfig(config: OmcsConfig): Buffer {
	const bytes = Buffer.from(`${JSON.stringify(config, null, "\t")}\n`, "utf8");
	parseOmcsConfig(bytes, "written");
	return bytes;
}

async function ensureSafeParent(path: string, create: boolean): Promise<string> {
	const parent = dirname(path);
	const root = parse(parent).root;
	const components = relative(root, parent).split(sep).filter(Boolean);
	let current = root;
	for (const component of components) {
		current = resolve(current, component);
		try {
			const state = await lstat(current);
			// macOS exposes its temporary tree via root-owned /var -> /private/var.
			if (state.isSymbolicLink() && (current === "/var" || current === "/tmp")) continue;
			if (state.isSymbolicLink()) throw refuses(`symlinked ancestor: ${current}`);
			if (!state.isDirectory()) throw refuses(`non-directory ancestor: ${current}`);
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

async function openDirectoryGuard(directory: string): Promise<DirectoryGuard> {
	const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
	try {
		const descriptor = await handle.stat();
		const named = await lstat(directory);
		if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(descriptor, named)) {
			throw refuses(`containing directory changed: ${directory}`);
		}
		return { path: directory, handle, dev: descriptor.dev, ino: descriptor.ino };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function verifyDirectory(guard: DirectoryGuard): Promise<void> {
	const descriptor = await guard.handle.stat();
	const named = await lstat(guard.path);
	if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory()
		|| !sameIdentity(descriptor, guard) || !sameIdentity(named, guard)) {
		throw refuses(`containing directory changed: ${guard.path}`);
	}
}

async function closeDirectoryGuard(guard: DirectoryGuard | undefined): Promise<void> {
	await guard?.handle.close();
}

async function snapshotFile(path: string): Promise<FileSnapshot | null> {
	let handle: FileHandle | undefined;
	try {
		const namedBefore = await lstat(path);
		if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== 1) throw refuses(`unsafe existing file: ${path}`);
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = await handle.stat();
		if (!before.isFile() || before.nlink !== 1 || before.size < 0 || before.size > MAX_CONFIG_BYTES || !sameIdentity(before, namedBefore)) {
			throw refuses(`unsafe existing file: ${path}`);
		}
		const bytes = await handle.readFile();
		const after = await handle.stat();
		const namedAfter = await lstat(path);
		if (bytes.byteLength > MAX_CONFIG_BYTES || !sameIdentity(before, after) || !sameIdentity(after, namedAfter)
			|| namedAfter.isSymbolicLink() || !namedAfter.isFile() || namedAfter.nlink !== 1) {
			throw refuses(`existing file changed while reading: ${path}`);
		}
		return { bytes, dev: after.dev, ino: after.ino };
	} catch (error) {
		if (!handle && isMissing(error)) return null;
		throw error;
	} finally {
		await handle?.close();
	}
}

async function stageFile(guard: DirectoryGuard, target: string, bytes: Buffer): Promise<StagedFile> {
	await verifyDirectory(guard);
	const path = join(guard.path, `.${basename(target)}.omcs-${randomUUID()}.tmp`);
	let handle: FileHandle | undefined;
	try {
		handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
		await handle.chmod(0o644);
		await handle.writeFile(bytes);
		await verifyDirectory(guard);
		await handle.sync();
		const state = await handle.stat();
		if (!state.isFile() || state.nlink !== 1) throw refuses(`unsafe staged file: ${path}`);
		await handle.close();
		handle = undefined;
		await verifyDirectory(guard);
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

async function commitStagedNoClobber(guard: DirectoryGuard, stage: StagedFile, target: string, desired: Buffer): Promise<void> {
	await verifyDirectory(guard);
	await link(stage.path, target);
	await verifyDirectory(guard);
	await removePath(guard, stage.path);
	const committed = await snapshotFile(target);
	if (!committed || !committed.bytes.equals(desired) || !sameIdentity(committed, stage)) throw refuses("committed configuration changed");
	await syncDirectory(guard);
}

async function rollbackCommitted(
	guard: DirectoryGuard,
	target: string,
	desired: Buffer,
	priorQuarantine: string | undefined,
): Promise<void> {
	await verifyDirectory(guard);
	const current = await snapshotFile(target);
	if (!current || !current.bytes.equals(desired)) throw new Error("OMCS refuses rollback because committed configuration changed");
	const committedQuarantine = await moveToQuarantine(guard, target);
	try {
		const moved = await snapshotFile(committedQuarantine);
		if (!moved || !moved.bytes.equals(desired) || !sameIdentity(moved, current)) throw new Error("OMCS committed configuration changed during rollback");
		await testHooks?.beforeRestore?.();
		if (priorQuarantine) await restorePriorNoClobber(guard, target, priorQuarantine);
		await removePath(guard, committedQuarantine);
		await syncDirectory(guard);
	} catch (error) {
		// Keep both quarantine paths as recovery evidence; never overwrite a new file.
		throw new Error("OMCS configuration rollback could not safely restore prior bytes", { cause: error });
	}
}

/**
 * Creates a new config or explicitly replaces a parseable prior OMCS config.
 * A quarantine plus hard-link CAS avoids clobbering files that appear or change
 * after validation. No ownership manifest is written into the project.
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

	let guard: DirectoryGuard | undefined;
	let stage: StagedFile | undefined;
	let priorQuarantine: string | undefined;
	let committed = false;
	try {
		guard = await openDirectoryGuard(directory);
		await testHooks?.beforeStage?.();
		await verifyDirectory(guard);
		stage = await stageFile(guard, path, bytes);
		await testHooks?.beforeCommit?.();
		await verifyDirectory(guard);
		if (existing) {
			priorQuarantine = await moveToQuarantine(guard, path);
			const moved = await snapshotFile(priorQuarantine);
			if (!moved || !moved.bytes.equals(existing.bytes) || !sameIdentity(moved, existing)) {
				await restorePriorNoClobber(guard, path, priorQuarantine);
				priorQuarantine = undefined;
				throw new Error("OMCS configuration changed before commit");
			}
		} else if (await snapshotFile(path)) {
			throw new Error("OMCS configuration appeared before commit");
		}
		await commitStagedNoClobber(guard, stage, path, bytes);
		stage = undefined;
		committed = true;
		await testHooks?.afterCommit?.();
		if (priorQuarantine) {
			await removePath(guard, priorQuarantine);
			priorQuarantine = undefined;
			await syncDirectory(guard);
		}
		return { action, path, bytes: bytes.byteLength };
	} catch (error) {
		try {
			if (stage && guard) await removePath(guard, stage.path);
			if (committed && guard) {
				await rollbackCommitted(guard, path, bytes, priorQuarantine);
				priorQuarantine = undefined;
			} else if (priorQuarantine && guard) {
				await restorePriorNoClobber(guard, path, priorQuarantine);
				priorQuarantine = undefined;
			}
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "OMCS configuration commit and rollback failed");
		}
		throw error;
	} finally {
		if (stage && guard) await removePath(guard, stage.path).catch(() => undefined);
		await closeDirectoryGuard(guard);
	}
}
