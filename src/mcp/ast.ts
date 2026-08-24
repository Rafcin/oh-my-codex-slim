import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	chmod,
	copyFile,
	link,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	stat,
	type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export interface ChildProcessOptions {
	cwd: string;
	timeout: number;
	maxBuffer?: number;
	env: NodeJS.ProcessEnv;
}

export type ChildProcessRunner = (
	file: string,
	args: readonly string[],
	options: ChildProcessOptions,
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
const defaultChildProcessRunner: ChildProcessRunner = async (
	file,
	args,
	options,
) => {
	const result = await execFileAsync(file, [...args], options);
	return { stdout: result.stdout, stderr: result.stderr };
};

export function minimalChildEnvironment(): NodeJS.ProcessEnv {
	return { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" };
}

export interface ToolError {
	code: string;
	message: string;
}

export type ToolResult<T = unknown> =
	| { ok: true; data: T }
	| { ok: false; error: ToolError };

export class SafePathError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "SafePathError";
		this.code = code;
	}
}

interface EntryIdentity {
	path: string;
	dev: number;
	ino: number;
	mode: number;
	nlink: number;
	size: number;
	kind: "directory" | "file";
}

export interface ProjectPathSnapshot {
	root: string;
	target: string;
	entries: readonly EntryIdentity[];
	digest?: string;
}

function containedBy(root: string, target: string): boolean {
	const rel = relative(root, target);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}

function bytesDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function identity(
	path: string,
	info: Awaited<ReturnType<typeof lstat>>,
): EntryIdentity {
	if (info.isSymbolicLink())
		throw new SafePathError(
			"path-outside-project",
			"Symbolic links are not accepted in project paths",
		);
	const kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : null;
	if (!kind)
		throw new SafePathError(
			"invalid-target",
			"Project paths must contain only directories and regular files",
		);
	if (kind === "file" && info.nlink !== 1)
		throw new SafePathError(
			"ownership-conflict",
			"Hard-linked project files are not safe mutation or inspection targets",
		);
	return {
		path,
		dev: Number(info.dev),
		ino: Number(info.ino),
		mode: Number(info.mode),
		nlink: Number(info.nlink),
		size: Number(info.size),
		kind,
	};
}

function sameIdentity(expected: EntryIdentity, actual: EntryIdentity): boolean {
	return (
		expected.path === actual.path &&
		expected.dev === actual.dev &&
		expected.ino === actual.ino &&
		expected.mode === actual.mode &&
		(expected.kind === "directory" || expected.nlink === actual.nlink) &&
		(expected.kind === "directory" || expected.size === actual.size) &&
		expected.kind === actual.kind
	);
}

export const MAX_INSPECTED_FILE_BYTES = 8 * 1024 * 1024;

async function readBoundedRegularFile(path: string): Promise<Buffer> {
	const handle = await open(path, "r");
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.nlink !== 1)
			throw new SafePathError(
				"ownership-conflict",
				"Project file identity is unsafe",
			);
		if (before.size > MAX_INSPECTED_FILE_BYTES)
			throw new SafePathError(
				"resource-limit",
				"Project file exceeds the inspection byte limit",
			);
		const bytes = Buffer.alloc(Number(before.size));
		let offset = 0;
		while (offset < bytes.length) {
			const result = await handle.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (result.bytesRead === 0) break;
			offset += result.bytesRead;
		}
		const after = await handle.stat();
		if (
			offset !== bytes.length ||
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.nlink !== before.nlink
		) {
			throw new SafePathError(
				"ownership-conflict",
				"Project file changed during inspection",
			);
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

export async function canonicalProjectRoot(root: string): Promise<string> {
	try {
		const canonical = await realpath(resolve(root));
		if (!(await stat(canonical)).isDirectory())
			throw new SafePathError(
				"invalid-project-root",
				"Project root is not a directory",
			);
		return canonical;
	} catch (error) {
		if (error instanceof SafePathError) throw error;
		throw new SafePathError(
			"invalid-project-root",
			"Project root does not exist or cannot be resolved",
		);
	}
}

export async function captureProjectPath(
	root: string,
	requestedPath: string,
): Promise<ProjectPathSnapshot> {
	const canonicalRoot = await canonicalProjectRoot(root);
	if (requestedPath.includes("\0"))
		throw new SafePathError(
			"path-outside-project",
			"Path contains an invalid null byte",
		);
	const target = resolve(canonicalRoot, requestedPath || ".");
	if (!containedBy(canonicalRoot, target))
		throw new SafePathError(
			"path-outside-project",
			"Path resolves outside the project root",
		);
	const entries: EntryIdentity[] = [
		identity(canonicalRoot, await lstat(canonicalRoot)),
	];
	let cursor = canonicalRoot;
	for (const component of relative(canonicalRoot, target)
		.split(sep)
		.filter(Boolean)) {
		cursor = join(cursor, component);
		try {
			entries.push(identity(cursor, await lstat(cursor)));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new SafePathError(
					"path-not-found",
					"Requested project path does not exist",
				);
			throw error;
		}
	}
	const canonicalTarget = await realpath(target);
	if (
		!containedBy(canonicalRoot, canonicalTarget) ||
		canonicalTarget !== target
	) {
		throw new SafePathError(
			"path-outside-project",
			"Path resolves through an unsafe alias or outside the project root",
		);
	}
	const finalEntry = entries.at(-1);
	const digest =
		finalEntry?.kind === "file"
			? bytesDigest(await readBoundedRegularFile(target))
			: undefined;
	return { root: canonicalRoot, target, entries, digest };
}

export async function revalidateProjectPath(
	snapshot: ProjectPathSnapshot,
): Promise<void> {
	for (const expected of snapshot.entries) {
		let actual: EntryIdentity;
		try {
			actual = identity(expected.path, await lstat(expected.path));
		} catch (error) {
			if (error instanceof SafePathError) throw error;
			throw new SafePathError(
				"ownership-conflict",
				"A project path changed during the operation",
			);
		}
		if (!sameIdentity(expected, actual))
			throw new SafePathError(
				"ownership-conflict",
				"A project path changed during the operation",
			);
	}
	if (
		(await realpath(snapshot.target)) !== snapshot.target ||
		!containedBy(snapshot.root, snapshot.target)
	) {
		throw new SafePathError(
			"ownership-conflict",
			"Project path containment changed during the operation",
		);
	}
	if (
		snapshot.digest !== undefined &&
		bytesDigest(await readBoundedRegularFile(snapshot.target)) !==
			snapshot.digest
	) {
		throw new SafePathError(
			"ownership-conflict",
			"Target bytes changed during the operation",
		);
	}
}

export async function resolveProjectPath(
	root: string,
	requestedPath: string,
): Promise<string> {
	return (await captureProjectPath(root, requestedPath)).target;
}

export function errorResult(
	error: unknown,
	fallbackCode = "operation-failed",
): ToolResult<never> {
	if (error instanceof SafePathError)
		return { ok: false, error: { code: error.code, message: error.message } };
	return {
		ok: false,
		error: {
			code: error instanceof AggregateError ? "rollback-failed" : fallbackCode,
			message:
				"The operation failed without exposing external command arguments or output",
		},
	};
}

export async function ensureSafeDirectory(
	root: string,
	relativeDirectory: string,
): Promise<{ path: string; created: string[] }> {
	const canonicalRoot = await canonicalProjectRoot(root);
	const target = resolve(canonicalRoot, relativeDirectory);
	if (!containedBy(canonicalRoot, target))
		throw new SafePathError(
			"path-outside-project",
			"Directory resolves outside the project root",
		);
	const created: string[] = [];
	let cursor = canonicalRoot;
	for (const component of relative(canonicalRoot, target)
		.split(sep)
		.filter(Boolean)) {
		cursor = join(cursor, component);
		try {
			const entry = await lstat(cursor);
			if (entry.isSymbolicLink() || !entry.isDirectory())
				throw new SafePathError(
					"path-outside-project",
					"Managed directory path is unsafe",
				);
		} catch (error) {
			if (error instanceof SafePathError) throw error;
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await mkdir(cursor, { mode: 0o700 });
			created.push(cursor);
		}
	}
	return { path: target, created };
}

async function removeCreatedDirectories(
	created: readonly string[],
): Promise<void> {
	for (const path of [...created].reverse()) {
		try {
			await rmdir(path);
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "ENOTEMPTY" &&
				(error as NodeJS.ErrnoException).code !== "ENOENT"
			)
				throw error;
		}
	}
}

async function writeNewAtomic(path: string, bytes: Buffer): Promise<void> {
	const temporary = join(
		dirname(path),
		`.${basename(path)}.omcs-tmp-${process.pid}-${randomUUID()}`,
	);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let linked = false;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await link(temporary, path);
		linked = true;
		await rm(temporary);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		try {
			await handle?.close();
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		let temporaryRemoved = false;
		try {
			await rm(temporary, { force: true });
			temporaryRemoved = true;
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		if (cleanupErrors.length > 0)
			throw new AggregateError(
				[error, ...cleanupErrors],
				"Atomic backup cleanup failed",
			);
		if (linked && temporaryRemoved) return;
		throw error;
	}
}

export interface OwnedLock {
	path: string;
	dev: number;
	ino: number;
}

export interface LockIo {
	initialStat?: (
		handle: FileHandle,
	) => Promise<Awaited<ReturnType<FileHandle["stat"]>>>;
	recoverStat?: (
		handle: FileHandle,
	) => Promise<Awaited<ReturnType<FileHandle["stat"]>>>;
	write?: (handle: FileHandle, bytes: string) => Promise<void>;
	sync?: (handle: FileHandle) => Promise<void>;
	stat?: (
		handle: FileHandle,
	) => Promise<Awaited<ReturnType<FileHandle["stat"]>>>;
	close?: (handle: FileHandle) => Promise<void>;
	syncParent?: (path: string) => Promise<void>;
}

export interface LockDependencies {
	lockIo?: LockIo;
	afterLockFailure?: (path: string) => Promise<void>;
}

async function syncParentDirectory(
	path: string,
	override?: (path: string) => Promise<void>,
): Promise<void> {
	if (override) return await override(path);
	const parent = await open(dirname(path), "r");
	try {
		await parent.sync();
	} finally {
		await parent.close();
	}
}

export async function acquireOwnedLock(
	path: string,
	dependencies: LockDependencies = {},
): Promise<OwnedLock> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let created: OwnedLock | undefined;
	try {
		handle = await open(path, "wx", 0o600);
		const opened = await (
			dependencies.lockIo?.initialStat ?? ((target) => target.stat())
		)(handle);
		const openedIdentity = {
			path,
			dev: Number(opened.dev),
			ino: Number(opened.ino),
		};
		created = openedIdentity;
		if (!opened.isFile() || opened.nlink !== 1)
			throw new Error("unsafe initial lock identity");
		await (
			dependencies.lockIo?.write ?? ((target, bytes) => target.writeFile(bytes))
		)(handle, `oh-my-codex-slim ${process.pid}\n`);
		await (dependencies.lockIo?.sync ?? ((target) => target.sync()))(handle);
		const info = await (
			dependencies.lockIo?.stat ?? ((target) => target.stat())
		)(handle);
		if (!info.isFile() || info.nlink !== 1)
			throw new Error("unsafe lock identity");
		if (
			Number(info.dev) !== openedIdentity.dev ||
			Number(info.ino) !== openedIdentity.ino
		)
			throw new SafePathError(
				"ownership-conflict",
				"Mutation lock identity changed during acquisition",
			);
		await (dependencies.lockIo?.close ?? ((target) => target.close()))(handle);
		handle = undefined;
		return { path, dev: Number(info.dev), ino: Number(info.ino) };
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		if (handle && !created) {
			try {
				const recovered = await (
					dependencies.lockIo?.recoverStat ?? ((target) => target.stat())
				)(handle);
				if (!recovered.isFile())
					throw new Error("unsafe recovered lock identity");
				created = {
					path,
					dev: Number(recovered.dev),
					ino: Number(recovered.ino),
				};
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (handle) {
			try {
				await dependencies.afterLockFailure?.(path);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			try {
				await handle?.close();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (created) {
			try {
				const current = await lstat(path);
				if (
					!current.isSymbolicLink() &&
					current.isFile() &&
					current.dev === created.dev &&
					current.ino === created.ino
				) {
					await rm(path);
					await syncParentDirectory(path, dependencies.lockIo?.syncParent);
				}
			} catch (cleanupError) {
				if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
					cleanupErrors.push(cleanupError);
			}
		}
		if (cleanupErrors.length > 0)
			throw new AggregateError(
				[error, ...cleanupErrors],
				"Mutation lock cleanup failed",
			);
		if (!created && (error as NodeJS.ErrnoException).code === "EEXIST")
			throw new SafePathError(
				"ownership-conflict",
				"An OMCS mutation lock already exists",
			);
		throw error;
	}
}

export async function releaseOwnedLock(lock: OwnedLock): Promise<void> {
	const info = await lstat(lock.path);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.nlink !== 1 ||
		info.dev !== lock.dev ||
		info.ino !== lock.ino
	) {
		throw new SafePathError(
			"ownership-conflict",
			"OMCS mutation lock identity changed",
		);
	}
	await rm(lock.path);
	await syncParentDirectory(lock.path);
}

export function resolvePinnedAstGrepExecutable(): string {
	const packageJson = fileURLToPath(
		import.meta.resolve("@ast-grep/cli/package.json"),
	);
	return join(
		dirname(packageJson),
		process.platform === "win32" ? "ast-grep.exe" : "ast-grep",
	);
}

async function verifiedAstGrepExecutable(): Promise<string> {
	const executable = resolvePinnedAstGrepExecutable();
	await access(executable, constants.X_OK);
	const executableInfo = await lstat(executable);
	if (
		!executableInfo.isFile() ||
		executableInfo.isSymbolicLink() ||
		executableInfo.nlink !== 1
	)
		throw new Error("Pinned ast-grep executable is unsafe");
	const packageJson = JSON.parse(
		await readFile(join(dirname(executable), "package.json"), "utf8"),
	) as { version?: unknown };
	if (packageJson.version !== "0.45.1")
		throw new Error("Pinned ast-grep package version does not match 0.45.1");
	return executable;
}

export interface AstSearchInput {
	root: string;
	path: string;
	pattern: string;
	language: string;
	maxResults?: number;
}

export interface AstDependencies {
	run?: ChildProcessRunner;
	beforeCommit?: () => Promise<void>;
	createBackup?: (path: string, bytes: Buffer) => Promise<void>;
	commitTarget?: (from: string, to: string) => Promise<void>;
	afterTargetCommit?: () => Promise<void>;
	afterTargetRename?: (path: string) => Promise<void>;
	restoreTarget?: (from: string, to: string) => Promise<void>;
	removePath?: (path: string) => Promise<void>;
	lockIo?: LockIo;
	afterLockFailure?: (path: string) => Promise<void>;
}

export async function astSearch(
	input: AstSearchInput,
	dependencies: AstDependencies = {},
): Promise<ToolResult<unknown[]>> {
	try {
		const snapshot = await captureProjectPath(input.root, input.path);
		const executable = await verifiedAstGrepExecutable();
		await revalidateProjectPath(snapshot);
		const { stdout } = await (dependencies.run ?? defaultChildProcessRunner)(
			executable,
			[
				"run",
				"--pattern",
				input.pattern,
				"--lang",
				input.language,
				"--json",
				snapshot.target,
			],
			{
				cwd: snapshot.root,
				timeout: 30_000,
				maxBuffer: 10 * 1024 * 1024,
				env: minimalChildEnvironment(),
			},
		);
		await revalidateProjectPath(snapshot);
		const parsed = JSON.parse(stdout) as unknown;
		const matches = Array.isArray(parsed) ? parsed : [parsed];
		return {
			ok: true,
			data: input.maxResults ? matches.slice(0, input.maxResults) : matches,
		};
	} catch (error) {
		const commandError = error as {
			code?: string | number | null;
			stdout?: string;
		};
		if (
			commandError.code === 1 &&
			typeof commandError.stdout === "string" &&
			commandError.stdout.trim() === ""
		)
			return { ok: true, data: [] };
		return errorResult(error, "ast-grep-failed");
	}
}

export interface AstReplaceInput extends AstSearchInput {
	replacement: string;
	dryRun?: boolean;
	now?: () => Date;
}

async function rewriteTemporaryFile(
	executable: string,
	path: string,
	input: AstReplaceInput,
	cwd: string,
	runner: ChildProcessRunner,
): Promise<void> {
	await runner(
		executable,
		[
			"run",
			"--pattern",
			input.pattern,
			"--rewrite",
			input.replacement,
			"--lang",
			input.language,
			"--update-all",
			path,
		],
		{
			cwd,
			timeout: 30_000,
			maxBuffer: 10 * 1024 * 1024,
			env: minimalChildEnvironment(),
		},
	);
}

interface ExactFileIdentity {
	dev: number;
	ino: number;
	mode: number;
	nlink: number;
	digest: string;
}

async function captureExactFile(path: string): Promise<ExactFileIdentity> {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
		throw new SafePathError(
			"ownership-conflict",
			"Staged file identity is unsafe",
		);
	return {
		dev: info.dev,
		ino: info.ino,
		mode: info.mode,
		nlink: info.nlink,
		digest: bytesDigest(await readBoundedRegularFile(path)),
	};
}

async function adoptExactCommittedFile(
	root: string,
	path: string,
	expected: ExactFileIdentity,
): Promise<ProjectPathSnapshot> {
	const snapshot = await captureProjectPath(root, relative(root, path));
	const actual = await captureExactFile(path);
	if (
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino ||
		actual.mode !== expected.mode ||
		actual.nlink !== expected.nlink ||
		actual.digest !== expected.digest
	) {
		throw new SafePathError(
			"ownership-conflict",
			"Committed target is not the exact staged file",
		);
	}
	return snapshot;
}

export async function astReplace(
	input: AstReplaceInput,
	dependencies: AstDependencies = {},
): Promise<ToolResult<{ changed: boolean; backup?: string }>> {
	let temporaryPath: string | undefined;
	let scratchDirectory: string | undefined;
	let backupPath: string | undefined;
	let backupCommitted = false;
	let committedTarget: ProjectPathSnapshot | undefined;
	let commitAttempted = false;
	let original: Buffer | undefined;
	let originalMode: number | undefined;
	let lock: OwnedLock | undefined;
	const createdDirectories: string[] = [];
	const cleanupErrors: unknown[] = [];
	let primaryError: unknown;
	let success: { changed: boolean; backup?: string } | undefined;
	const removePath =
		dependencies.removePath ?? ((path: string) => rm(path, { force: true }));
	try {
		const snapshot = await captureProjectPath(input.root, input.path);
		const finalEntry = snapshot.entries.at(-1);
		if (finalEntry?.kind !== "file")
			throw new SafePathError(
				"invalid-target",
				"AST replacement requires one regular file",
			);
		const executable = await verifiedAstGrepExecutable();
		original = await readBoundedRegularFile(snapshot.target);
		originalMode = finalEntry.mode & 0o777;
		const runner = dependencies.run ?? defaultChildProcessRunner;

		if (input.dryRun !== false) {
			scratchDirectory = await mkdtemp(join(tmpdir(), "omcs-ast-preview-"));
			temporaryPath = join(scratchDirectory, basename(snapshot.target));
			await copyFile(snapshot.target, temporaryPath);
			await rewriteTemporaryFile(
				executable,
				temporaryPath,
				input,
				scratchDirectory,
				runner,
			);
			success = {
				changed: !original.equals(await readBoundedRegularFile(temporaryPath)),
			};
		} else {
			temporaryPath = join(
				dirname(snapshot.target),
				`omcs-ast-${process.pid}-${randomUUID()}-${basename(snapshot.target)}`,
			);
			await copyFile(snapshot.target, temporaryPath, constants.COPYFILE_EXCL);
			await chmod(temporaryPath, finalEntry.mode & 0o777);
			await rewriteTemporaryFile(
				executable,
				temporaryPath,
				input,
				snapshot.root,
				runner,
			);
			const rewritten = await readBoundedRegularFile(temporaryPath);
			if (original.equals(rewritten)) {
				await rm(temporaryPath);
				temporaryPath = undefined;
				success = { changed: false };
			} else {
				const backupDirectory = await ensureSafeDirectory(
					snapshot.root,
					".omcs/backups/ast",
				);
				createdDirectories.push(...backupDirectory.created);
				const lockDirectory = await ensureSafeDirectory(
					snapshot.root,
					".omcs/locks/ast",
				);
				createdDirectories.push(...lockDirectory.created);
				const pathKey = bytesDigest(
					Buffer.from(relative(snapshot.root, snapshot.target)),
				).slice(0, 24);
				lock = await acquireOwnedLock(
					join(lockDirectory.path, `${pathKey}.lock`),
					dependencies,
				);
				await dependencies.beforeCommit?.();
				await revalidateProjectPath(snapshot);
				const stamp = (input.now ?? (() => new Date()))()
					.toISOString()
					.replace(/[:.]/g, "-");
				backupPath = join(
					backupDirectory.path,
					`${stamp}-${pathKey}-${basename(snapshot.target)}`,
				);
				try {
					await (dependencies.createBackup ?? writeNewAtomic)(
						backupPath,
						original,
					);
					backupCommitted = true;
				} catch (backupError) {
					try {
						const backupInfo = await lstat(backupPath);
						if (
							backupInfo.isFile() &&
							!backupInfo.isSymbolicLink() &&
							backupInfo.nlink === 1 &&
							bytesDigest(await readFile(backupPath)) === bytesDigest(original)
						)
							backupCommitted = true;
					} catch (adoptionError) {
						if ((adoptionError as NodeJS.ErrnoException).code !== "ENOENT")
							cleanupErrors.push(adoptionError);
					}
					throw backupError;
				}
				await revalidateProjectPath(snapshot);
				const stagedTargetPath = temporaryPath;
				const stagedTarget = await captureExactFile(stagedTargetPath);
				commitAttempted = true;
				try {
					await (dependencies.commitTarget ?? rename)(
						stagedTargetPath,
						snapshot.target,
					);
					await dependencies.afterTargetRename?.(snapshot.target);
					committedTarget = await adoptExactCommittedFile(
						snapshot.root,
						snapshot.target,
						stagedTarget,
					);
					temporaryPath = undefined;
				} catch (commitError) {
					try {
						const stillStaged = await captureExactFile(stagedTargetPath);
						if (
							stillStaged.dev === stagedTarget.dev &&
							stillStaged.ino === stagedTarget.ino &&
							stillStaged.digest === stagedTarget.digest
						) {
							commitAttempted = false;
							throw commitError;
						}
					} catch (stagedError) {
						if (stagedError === commitError) throw stagedError;
						if ((stagedError as NodeJS.ErrnoException).code !== "ENOENT")
							cleanupErrors.push(stagedError);
					}
					try {
						committedTarget = await adoptExactCommittedFile(
							snapshot.root,
							snapshot.target,
							stagedTarget,
						);
						temporaryPath = undefined;
					} catch (adoptionError) {
						if (
							adoptionError instanceof SafePathError &&
							adoptionError.code === "ownership-conflict"
						)
							throw adoptionError;
						if ((adoptionError as NodeJS.ErrnoException).code !== "ENOENT")
							cleanupErrors.push(adoptionError);
					}
					throw commitError;
				}
				await dependencies.afterTargetCommit?.();
				await releaseOwnedLock(lock);
				lock = undefined;
				success = {
					changed: true,
					backup: relative(snapshot.root, backupPath).split(sep).join("/"),
				};
			}
		}
	} catch (error) {
		primaryError = error;
		let targetRestored = !commitAttempted;
		if (committedTarget && original && originalMode !== undefined) {
			let rollbackPath: string | undefined;
			try {
				await revalidateProjectPath(committedTarget);
				rollbackPath = join(
					dirname(committedTarget.target),
					`.omcs-ast-rollback-${process.pid}-${randomUUID()}`,
				);
				let handle: Awaited<ReturnType<typeof open>> | undefined;
				try {
					handle = await open(rollbackPath, "wx", originalMode);
					await handle.writeFile(original);
					await handle.sync();
					await handle.chmod(originalMode);
					await handle.close();
					handle = undefined;
				} catch (stageError) {
					try {
						await handle?.close();
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
					throw stageError;
				}
				await (dependencies.restoreTarget ?? rename)(
					rollbackPath,
					committedTarget.target,
				);
				rollbackPath = undefined;
				targetRestored = true;
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			} finally {
				if (rollbackPath) {
					try {
						await removePath(rollbackPath);
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
				}
			}
		}
		if (targetRestored && backupCommitted && backupPath) {
			try {
				await removePath(backupPath);
				backupCommitted = false;
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
	} finally {
		if (temporaryPath) {
			try {
				await removePath(temporaryPath);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (scratchDirectory) {
			try {
				await rm(scratchDirectory, { recursive: true, force: true });
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (lock) {
			try {
				await releaseOwnedLock(lock);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			await removeCreatedDirectories(createdDirectories);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (primaryError || cleanupErrors.length > 0) {
		const error =
			cleanupErrors.length > 0
				? new AggregateError(
						[...(primaryError ? [primaryError] : []), ...cleanupErrors],
						"AST transaction rollback failed",
					)
				: primaryError;
		return errorResult(error, "ast-grep-failed");
	}
	return { ok: true, data: success ?? { changed: false } };
}
