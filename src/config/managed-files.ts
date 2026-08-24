import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename as fsRename, rm, rmdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
	canonicalizeCodexHome,
	codexHomeRelativePath,
	isOmcsManagedRelativePath,
} from "./codex-home.js";
import { extractManagedConfigBlock, hasManagedConfigBlock, mergeConfig, removeManagedConfigBlock } from "./generator.js";
import { readBoundedRegularFile } from "./safe-reader.js";

export interface ManagedFileRecord {
	path: string;
	sha256: string;
	installedAt: string;
	sourceVersion: string;
	ownedBlockSha256?: string;
}

export interface ManagedFilesManifest {
	files: ManagedFileRecord[];
}

export interface ManagedWriteOptions {
	codexHome: string;
	sourceVersion: string;
	installedAt?: string;
}

export interface ManagedWritePlan {
	relativePath: string;
	changed: boolean;
	backup: string | null;
}

export interface ManagedFileWriteRequest {
	path: string;
	bytes: Uint8Array;
}

export interface ManagedFilesWriteOptions extends ManagedWriteOptions {
	dryRun?: boolean;
}

export type ManagedFileWriter = (
	path: string,
	bytes: Uint8Array,
	options: ManagedWriteOptions,
	dependencies?: ManagedFileDependencies,
) => Promise<void>;

export interface ManagedFilesDependencies {
	writeManagedFile?: ManagedFileWriter;
}

export class ManagedOwnershipConflictsError extends Error {
	readonly paths: readonly string[];

	constructor(paths: readonly string[]) {
		super(`OMCS ownership conflicts: ${paths.join(", ")}`);
		this.name = "ManagedOwnershipConflictsError";
		this.paths = [...paths];
	}
}

const MANIFEST_DIRECTORY = "oh-my-codex-slim";
const MANIFEST_FILENAME = "managed-files.json";

export interface ManagedFileDependencies {
	rename?: (from: string, to: string) => Promise<void>;
	writeTemporary?: (path: string, bytes: Uint8Array, handle: Pick<FileHandle, "writeFile" | "sync">) => Promise<void>;
	beforeReplace?: (path: string) => Promise<void>;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as { code?: unknown }).code === "ENOENT";
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function validRecord(value: unknown): value is ManagedFileRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.path === "string"
		&& isOmcsManagedRelativePath(candidate.path)
		&& typeof candidate.sha256 === "string"
		&& /^[a-f0-9]{64}$/.test(candidate.sha256)
		&& typeof candidate.installedAt === "string"
		&& typeof candidate.sourceVersion === "string"
		&& (candidate.ownedBlockSha256 === undefined || (typeof candidate.ownedBlockSha256 === "string" && /^[a-f0-9]{64}$/.test(candidate.ownedBlockSha256)));
}

function parseManifest(bytes: string): ManagedFilesManifest {
	const parsed = JSON.parse(bytes) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("OMCS managed-file manifest is not an object");
	const files = (parsed as { files?: unknown }).files;
	if (!Array.isArray(files) || !files.every(validRecord)) throw new Error("OMCS managed-file manifest is invalid");
	const paths = new Set<string>();
	for (const record of files) {
		if (paths.has(record.path)) throw new Error("OMCS managed-file manifest contains duplicate paths");
		paths.add(record.path);
	}
	return { files };
}

async function safePath(codexHome: string, relativePath: string): Promise<string> {
	const root = await canonicalizeCodexHome(codexHome);
	const path = resolve(root, relativePath);
	if (codexHomeRelativePath(root, path) !== relativePath) throw new Error(`OMCS path escapes CODEX_HOME: ${relativePath}`);
	const components = relativePath.split("/");
	let current = root;
	for (const component of components) {
		current = join(current, component);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) throw new Error(`OMCS refuses symlinked managed path: ${relativePath}`);
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
	}
	return path;
}

async function readSafeRegularFile(path: string): Promise<Buffer | null> {
	return readBoundedRegularFile(path, { label: "managed file" });
}

async function ensureSafeDirectory(path: string): Promise<void> {
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`OMCS directory is unsafe: ${path}`);
		return;
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	await mkdir(path, { recursive: true });
	const stat = await lstat(path);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`OMCS directory is unsafe: ${path}`);
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function prepareTemporary(path: string, bytes: Uint8Array, dependencies: ManagedFileDependencies): Promise<string> {
	await ensureSafeDirectory(dirname(path));
	const temporaryPath = join(dirname(path), `.${basename(path)}.omcs-${randomUUID()}.tmp`);
	const handle = await open(temporaryPath, "wx", 0o600);
	let primaryError: unknown;
	try {
		if (dependencies.writeTemporary) await dependencies.writeTemporary(path, bytes, handle);
		else {
			await handle.writeFile(bytes);
			await handle.sync();
		}
	} catch (error) {
		primaryError = error;
	}
	try {
		await handle.close();
	} catch (error) {
		primaryError = primaryError ? new AggregateError([primaryError, error], "OMCS temporary close failed") : error;
	}
	if (primaryError) {
		try {
			await rm(temporaryPath, { force: true });
		} catch (cleanupError) {
			throw new AggregateError([primaryError, cleanupError], "OMCS temporary cleanup failed");
		}
		throw primaryError;
	}
	return temporaryPath;
}

async function restoreQuarantined(path: string, quarantine: string): Promise<void> {
	await link(quarantine, path);
	await rm(quarantine);
	await syncDirectory(dirname(path));
}

/** Replaces only an exact expected inode/content by quarantining it before a no-clobber link commit. */
async function replaceExpected(
	path: string,
	expected: Buffer | null,
	desired: Buffer | null,
	dependencies: ManagedFileDependencies,
	label: string,
): Promise<void> {
	await dependencies.beforeReplace?.(path);
	let quarantine: string | undefined;
	let temporary: string | undefined;
	try {
		if (expected) {
			quarantine = join(dirname(path), `.${basename(path)}.omcs-${randomUUID()}.quarantine`);
			await (dependencies.rename ?? fsRename)(path, quarantine);
			await syncDirectory(dirname(path));
			const moved = await readSafeRegularFile(quarantine);
			if (!moved?.equals(expected)) {
				try { await restoreQuarantined(path, quarantine); quarantine = undefined; } catch (rollbackError) {
					throw new AggregateError([new Error(`OMCS ${label} changed before commit`), rollbackError], `OMCS ${label} quarantine reconciliation failed`);
				}
				throw new Error(`OMCS ${label} changed before commit`);
			}
		} else if (await readSafeRegularFile(path)) {
			throw new Error(`OMCS ${label} appeared before commit`);
		}
		if (desired) {
			temporary = await prepareTemporary(path, desired, dependencies);
			await link(temporary, path);
			await rm(temporary);
			temporary = undefined;
			await syncDirectory(dirname(path));
		}
		if (quarantine) {
			await rm(quarantine);
			quarantine = undefined;
			await syncDirectory(dirname(path));
		}
	} catch (error) {
		if (temporary) await rm(temporary, { force: true });
		if (quarantine) {
			try { await restoreQuarantined(path, quarantine); } catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `OMCS ${label} replacement and rollback failed`);
			}
		}
		throw error;
	}
}

export function managedFilesManifestPath(codexHome: string): string {
	return join(resolve(codexHome), MANIFEST_DIRECTORY, MANIFEST_FILENAME);
}

async function readManifestSnapshot(codexHome: string): Promise<{ path: string; bytes: Buffer | null; manifest: ManagedFilesManifest }> {
	const path = await safePath(codexHome, `${MANIFEST_DIRECTORY}/${MANIFEST_FILENAME}`);
	const bytes = await readSafeRegularFile(path);
	return { path, bytes, manifest: bytes ? parseManifest(bytes.toString("utf8")) : { files: [] } };
}

export async function readManagedFilesManifest(codexHome: string): Promise<ManagedFilesManifest> {
	return (await readManifestSnapshot(codexHome)).manifest;
}

export async function readManagedFile(codexHome: string, relativePath: string): Promise<Buffer | null> {
	if (!isOmcsManagedRelativePath(relativePath)) throw new Error(`OMCS cannot read unmanaged path: ${relativePath}`);
	return readSafeRegularFile(await safePath(codexHome, relativePath));
}

function backupPath(path: string, installedAt: string): string {
	return `${path}.bak-${installedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
}

async function createPlan(path: string, bytes: Uint8Array, options: ManagedWriteOptions): Promise<{
	plan: ManagedWritePlan;
	targetPath: string;
	priorTarget: Buffer | null;
	manifestPath: string;
	priorManifest: Buffer | null;
	nextManifest: Buffer;
	desiredBytes: Buffer;
}> {
	const requestedHome = resolve(options.codexHome);
	const relativePath = codexHomeRelativePath(requestedHome, path);
	const codexHome = await canonicalizeCodexHome(requestedHome);
	if (!relativePath || !isOmcsManagedRelativePath(relativePath)) throw new Error("OMCS may only manage config.toml and agents/omcs-*.toml files inside CODEX_HOME");
	const targetPath = await safePath(codexHome, relativePath);
	const priorTarget = await readSafeRegularFile(targetPath);
	const snapshot = await readManifestSnapshot(codexHome);
	const previous = snapshot.manifest.files.find((record) => record.path === relativePath);
	if (priorTarget && (!previous || sha256(priorTarget) !== previous.sha256)) {
		// config.toml is block-owned: exact OMCS delimiters reserve only that block,
		// while all bytes outside it remain user-owned and may change independently.
		const currentBlock = extractManagedConfigBlock(priorTarget.toString("utf8"));
		const blockOwnedConfig = relativePath === "config.toml" && (previous
			? currentBlock !== null && previous.ownedBlockSha256 !== undefined && sha256(Buffer.from(currentBlock)) === previous.ownedBlockSha256
			: !hasManagedConfigBlock(priorTarget.toString("utf8")));
		if (!blockOwnedConfig) throw new Error(`OMCS ownership conflict: ${relativePath}`);
	}
	let desiredBytes = Buffer.from(bytes);
	if (relativePath === "config.toml" && priorTarget && hasManagedConfigBlock(desiredBytes.toString("utf8"))) {
		const desiredBlock = extractManagedConfigBlock(desiredBytes.toString("utf8"));
		if (!desiredBlock) throw new Error("OMCS desired config block is invalid");
		const blockBody = desiredBlock.split("\n").slice(1, -1).join("\n");
		desiredBytes = Buffer.from(mergeConfig(priorTarget.toString("utf8"), blockBody));
	}
	if (priorTarget && desiredBytes.equals(priorTarget)) {
		return {
			plan: { relativePath, changed: false, backup: null },
			targetPath, priorTarget, manifestPath: snapshot.path, priorManifest: snapshot.bytes,
			nextManifest: snapshot.bytes ?? Buffer.from('{\n  "files": []\n}\n'),
			desiredBytes,
		};
	}
	const installedAt = options.installedAt ?? new Date().toISOString();
	const backup = priorTarget ? backupPath(relativePath, installedAt) : null;
	if (backup && await readSafeRegularFile(await safePath(codexHome, backup))) throw new Error(`OMCS backup path already exists: ${backup}`);
	const ownedBlock = relativePath === "config.toml" ? extractManagedConfigBlock(desiredBytes.toString("utf8")) : null;
	const nextRecord: ManagedFileRecord = {
		path: relativePath,
		sha256: sha256(desiredBytes),
		installedAt,
		sourceVersion: options.sourceVersion,
		...(ownedBlock ? { ownedBlockSha256: sha256(Buffer.from(ownedBlock)) } : {}),
	};
	const nextManifest: ManagedFilesManifest = {
		files: [...snapshot.manifest.files.filter((record) => record.path !== relativePath), nextRecord].sort((left, right) => left.path.localeCompare(right.path)),
	};
	return {
		plan: { relativePath, changed: true, backup }, targetPath, priorTarget,
		manifestPath: snapshot.path, priorManifest: snapshot.bytes,
		nextManifest: Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`),
		desiredBytes,
	};
}

export async function planManagedFileWrite(path: string, bytes: Uint8Array, options: ManagedWriteOptions): Promise<ManagedWritePlan> {
	return (await createPlan(path, bytes, options)).plan;
}

/**
 * Commits a target and its digest record as one recoverable transaction. Every
 * rename is preceded by a fsynced sibling temporary file and followed by a
 * containing-directory fsync; caught failures restore the exact old target and
 * manifest bytes (or their absence).
 */
export async function writeManagedFile(path: string, bytes: Uint8Array, options: ManagedWriteOptions, dependencies: ManagedFileDependencies = {}): Promise<void> {
	const transaction = await createPlan(path, bytes, options);
	if (!transaction.plan.changed) return;
	let backupTarget: string | undefined;
	let targetCommitted = false;
	let manifestCommitted = false;
	let backupCommitted = false;
	try {
		if (transaction.plan.backup && transaction.priorTarget) {
			backupTarget = await safePath(options.codexHome, transaction.plan.backup);
			await replaceExpected(backupTarget, null, transaction.priorTarget, dependencies, "managed backup");
			backupCommitted = true;
		}
		await replaceExpected(transaction.targetPath, transaction.priorTarget, transaction.desiredBytes, dependencies, `target ${transaction.plan.relativePath}`);
		targetCommitted = true;
		await replaceExpected(transaction.manifestPath, transaction.priorManifest, transaction.nextManifest, dependencies, "managed manifest");
		manifestCommitted = true;
	} catch (error) {
		try {
			if (targetCommitted) {
				await replaceExpected(transaction.targetPath, transaction.desiredBytes, transaction.priorTarget, dependencies, `target ${transaction.plan.relativePath} rollback`);
			}
			if (manifestCommitted) {
				await replaceExpected(transaction.manifestPath, transaction.nextManifest, transaction.priorManifest, dependencies, "managed manifest rollback");
			}
			if (backupTarget && backupCommitted) {
				if (!transaction.priorTarget) throw new Error("OMCS managed backup rollback lacks its expected bytes");
				await replaceExpected(backupTarget, transaction.priorTarget, null, dependencies, "managed backup rollback");
			}
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "OMCS managed-file transaction and rollback failed");
		}
		throw error;
	}
}

/**
 * Applies a set of managed files as one operation. Per-file writes retain their
 * atomic transaction, while an operation failure restores every earlier target,
 * the shared manifest, and any backups created by the operation.
 */
export async function writeManagedFiles(
	requests: readonly ManagedFileWriteRequest[],
	options: ManagedFilesWriteOptions,
	dependencies: ManagedFilesDependencies = {},
): Promise<ManagedWritePlan[]> {
	const paths = new Set<string>();
	for (const request of requests) {
		const path = resolve(request.path);
		if (paths.has(path)) throw new Error(`OMCS managed-file batch contains duplicate path: ${path}`);
		paths.add(path);
	}
	const transactions: Awaited<ReturnType<typeof createPlan>>[] = [];
	const ownershipConflicts: string[] = [];
	for (const request of requests) {
		try {
			transactions.push(await createPlan(request.path, request.bytes, options));
		} catch (error) {
			const match = error instanceof Error ? /ownership conflict:\s+([^\s]+)/i.exec(error.message) : null;
			if (!match?.[1]) throw error;
			ownershipConflicts.push(match[1]);
		}
	}
	if (ownershipConflicts.length > 0) throw new ManagedOwnershipConflictsError(ownershipConflicts.sort());
	if (options.dryRun) return transactions.map((transaction) => transaction.plan);

	const directories = new Map<string, boolean>();
	async function snapshotDirectoryAncestors(path: string): Promise<void> {
		let current = resolve(path);
		while (true) {
			const known = directories.get(current);
			if (known === true) return;
			if (known === undefined) {
				try {
					const stat = await lstat(current);
					if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`OMCS directory is unsafe: ${current}`);
					directories.set(current, true);
					return;
				} catch (error) {
					if (!isMissing(error)) throw error;
					directories.set(current, false);
				}
			}
			const parent = dirname(current);
			if (parent === current) return;
			current = parent;
		}
	}
	for (const transaction of transactions) {
		for (const directory of [dirname(transaction.targetPath), dirname(transaction.manifestPath)]) {
			await snapshotDirectoryAncestors(directory);
		}
	}

	const completed: Array<{
		transaction: (typeof transactions)[number];
		priorTarget: Buffer | null;
		afterTarget: Buffer | null;
		priorManifest: Buffer | null;
		afterManifest: Buffer | null;
		afterBackup: Buffer | null;
	}> = [];
	const writer = dependencies.writeManagedFile ?? writeManagedFile;
	try {
		for (let index = 0; index < requests.length; index += 1) {
			const transaction = transactions[index];
			if (!transaction.plan.changed) continue;
			const request = requests[index];
			const priorTarget = await readSafeRegularFile(transaction.targetPath);
			const priorManifest = await readSafeRegularFile(transaction.manifestPath);
			await writer(request.path, request.bytes, options);
			completed.push({
				transaction,
				priorTarget,
				afterTarget: await readSafeRegularFile(transaction.targetPath),
				priorManifest,
				afterManifest: await readSafeRegularFile(transaction.manifestPath),
				afterBackup: transaction.plan.backup
					? await readSafeRegularFile(await safePath(options.codexHome, transaction.plan.backup))
					: null,
			});
		}
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		for (const completedWrite of [...completed].reverse()) {
			const { transaction } = completedWrite;
			try {
				let rollbackBytes = completedWrite.priorTarget;
				if (transaction.plan.relativePath === "config.toml" && completedWrite.afterTarget) {
					const currentText = completedWrite.afterTarget.toString("utf8");
					const previousBlock = completedWrite.priorTarget ? extractManagedConfigBlock(completedWrite.priorTarget.toString("utf8")) : null;
					rollbackBytes = completedWrite.priorTarget === null && completedWrite.afterTarget.equals(transaction.desiredBytes)
						? null
						: previousBlock
						? Buffer.from(mergeConfig(currentText, previousBlock.split("\n").slice(1, -1).join("\n")))
						: Buffer.from(removeManagedConfigBlock(currentText));
				}
				await replaceExpected(transaction.targetPath, completedWrite.afterTarget, rollbackBytes, {}, `batch target ${transaction.plan.relativePath} rollback`);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			if (transaction.plan.backup) {
				try {
					const path = await safePath(options.codexHome, transaction.plan.backup);
					if (!completedWrite.afterBackup) throw new Error("OMCS batch backup lacks expected bytes");
					await replaceExpected(path, completedWrite.afterBackup, null, {}, `batch backup ${transaction.plan.backup} rollback`);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
		}
		const firstCompleted = completed[0];
		const lastCompleted = completed.at(-1);
		if (firstCompleted && lastCompleted) {
			try {
				await replaceExpected(
					firstCompleted.transaction.manifestPath,
					lastCompleted.afterManifest,
					firstCompleted.priorManifest,
					{},
					"batch manifest rollback",
				);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		for (const [directory, existed] of [...directories].sort(([left], [right]) => right.length - left.length)) {
			if (existed) continue;
			try {
				await rmdir(directory);
			} catch (rollbackError) {
				if (!isMissing(rollbackError) && (rollbackError as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
					rollbackErrors.push(rollbackError);
				}
			}
		}
		if (rollbackErrors.length > 0) {
			throw new AggregateError([error, ...rollbackErrors], "OMCS managed-file batch and rollback failed");
		}
		throw error;
	}
	return transactions.map((transaction) => transaction.plan);
}

export async function managedRecordForPath(codexHome: string, relativePath: string): Promise<ManagedFileRecord | undefined> {
	return (await readManagedFilesManifest(codexHome)).files.find((record) => record.path === relativePath);
}

export function managedFileDigest(bytes: Uint8Array): string {
	return sha256(bytes);
}
