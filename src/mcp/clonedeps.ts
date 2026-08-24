import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	rmdir,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	canonicalProjectRoot,
	acquireOwnedLock,
	captureProjectPath,
	ensureSafeDirectory,
	errorResult,
	minimalChildEnvironment,
	revalidateProjectPath,
	releaseOwnedLock,
	SafePathError,
	type ChildProcessRunner,
	type LockIo,
	type OwnedLock,
	type ProjectPathSnapshot,
	type ToolResult,
} from "./ast.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultRunner: ChildProcessRunner = async (file, args, options) => {
	const result = await execFileAsync(file, [...args], options);
	return { stdout: result.stdout, stderr: result.stderr };
};
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_GIT_EXECUTABLE = "/usr/bin/git";

export interface CloneDependencyInput {
	root: string;
	url: string;
	destination: string;
	revision?: string;
	allowLocalSource?: boolean;
	now?: () => Date;
}

interface CloneRecord {
	path: string;
	url: string;
	revision: string;
}

interface CloneManifest {
	owner: "oh-my-codex-slim";
	schemaVersion: 1;
	repositories: CloneRecord[];
}

interface FileSnapshot {
	path: string;
	bytes: Buffer | null;
	digest: string | null;
	dev: number | null;
	ino: number | null;
	mode: number | null;
	nlink: number | null;
}

interface OwnedPath {
	path: string;
	dev: number;
	ino: number;
}

export interface CloneDependencies {
	run?: ChildProcessRunner;
	parentEnvironment?: NodeJS.ProcessEnv;
	gitExecutable?: string;
	beforeCommit?: () => Promise<void>;
	reserveDestination?: (path: string) => Promise<void>;
	moveClone?: (from: string, to: string) => Promise<void>;
	createBackup?: (path: string, bytes: Buffer) => Promise<void>;
	commitManifest?: (staged: string, target: string, existed: boolean) => Promise<void>;
	removePath?: (path: string) => Promise<void>;
	afterRepositoryMove?: (path: string) => Promise<void>;
	afterManifestCommit?: (path: string) => Promise<void>;
	afterManifestAdoption?: (path: string) => Promise<void>;
	lockIo?: LockIo;
	afterLockFailure?: (path: string) => Promise<void>;
}

function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function portablePath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

function gitEnvironment(protocol: "https" | "file"): NodeJS.ProcessEnv {
	return {
		...minimalChildEnvironment(),
		GIT_ALLOW_PROTOCOL: protocol,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
	};
}

async function verifiedGitExecutable(configured = DEFAULT_GIT_EXECUTABLE): Promise<string> {
	if (!isAbsolute(configured)) throw new SafePathError("invalid-executable", "Git executable must be an absolute installed path");
	const canonical = await realpath(configured);
	const info = await lstat(canonical);
	if (!info.isFile() || info.isSymbolicLink()) throw new SafePathError("invalid-executable", "Git executable is unavailable or unsafe");
	return canonical;
}

async function scanTree(path: string): Promise<Array<{ path: string; dev: number; ino: number; mode: number; nlink: number; digest?: string }>> {
	const records: Array<{ path: string; dev: number; ino: number; mode: number; nlink: number; digest?: string }> = [];
	async function visit(current: string): Promise<void> {
		const info = await lstat(current);
		if (info.isSymbolicLink()) throw new SafePathError("path-outside-project", "Dependency source or clone contains a symbolic link");
		if (!info.isDirectory() && !info.isFile()) throw new SafePathError("invalid-source", "Dependency trees may contain only directories and regular files");
		if (info.isFile() && info.nlink !== 1) throw new SafePathError("ownership-conflict", "Hard-linked dependency files are not accepted");
		records.push({
			path: current,
			dev: info.dev,
			ino: info.ino,
			mode: info.mode,
			nlink: info.nlink,
			digest: info.isFile() ? digest(await readFile(current)) : undefined,
		});
		if (info.isDirectory()) for (const child of (await readdir(current)).sort()) await visit(join(current, child));
	}
	await visit(path);
	return records;
}

async function revalidateTree(records: Awaited<ReturnType<typeof scanTree>>): Promise<void> {
	for (const expected of records) {
		const info = await lstat(expected.path);
		if (info.isSymbolicLink()
			|| info.dev !== expected.dev
			|| info.ino !== expected.ino
			|| info.mode !== expected.mode
			|| info.nlink !== expected.nlink
			|| (expected.digest !== undefined && digest(await readFile(expected.path)) !== expected.digest)) {
			throw new SafePathError("ownership-conflict", "Dependency source changed during clone");
		}
	}
}

async function adoptExactMovedTree(
	root: string,
	stagedRoot: string,
	committedRoot: string,
	expected: Awaited<ReturnType<typeof scanTree>>,
): Promise<Awaited<ReturnType<typeof scanTree>>> {
	await captureProjectPath(root, portablePath(root, committedRoot));
	const actual = await scanTree(committedRoot);
	if (actual.length !== expected.length) throw new SafePathError("ownership-conflict", "Committed repository tree differs from the staged tree");
	for (let index = 0; index < expected.length; index += 1) {
		const wanted = expected[index] as (typeof expected)[number];
		const found = actual[index] as (typeof actual)[number];
		if (relative(stagedRoot, wanted.path) !== relative(committedRoot, found.path)
			|| wanted.dev !== found.dev || wanted.ino !== found.ino || wanted.mode !== found.mode
			|| wanted.nlink !== found.nlink || wanted.digest !== found.digest) {
			throw new SafePathError("ownership-conflict", "Committed repository is not the exact staged tree");
		}
	}
	return actual;
}

async function sourceArgument(
	input: CloneDependencyInput,
	root: string,
): Promise<{ value: string; protocol: "https" | "file"; snapshot?: Awaited<ReturnType<typeof scanTree>> }> {
	let parsed: URL | undefined;
	try { parsed = new URL(input.url); } catch { parsed = undefined; }
	if (parsed) {
		if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
			throw new SafePathError("invalid-source", "Dependency sources must be credential-free HTTPS URLs");
		}
		return { value: input.url, protocol: "https" };
	}
	if (!input.allowLocalSource) throw new SafePathError("invalid-source", "Local dependency sources are accepted only for explicit fixtures");
	const localInput = isAbsolute(input.url) ? input.url : resolve(root, input.url);
	const canonical = await realpath(localInput);
	const local = (await captureProjectPath(root, canonical)).target;
	return { value: local, protocol: "file", snapshot: await scanTree(local) };
}

function parseManifest(bytes: Buffer): CloneManifest {
	try {
		const parsed = JSON.parse(bytes.toString("utf8")) as { owner?: unknown; schemaVersion?: unknown; repositories?: unknown };
		if (parsed.owner !== "oh-my-codex-slim" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) throw new Error("owner");
		const repositories = parsed.repositories.map((record) => {
			if (!record || typeof record !== "object") throw new Error("record");
			const candidate = record as Record<string, unknown>;
			if (typeof candidate.path !== "string" || typeof candidate.url !== "string" || typeof candidate.revision !== "string") throw new Error("fields");
			return { path: candidate.path, url: candidate.url, revision: candidate.revision };
		});
		return { owner: "oh-my-codex-slim", schemaVersion: 1, repositories };
	} catch {
		throw new SafePathError("ownership-conflict", "Clone manifest is malformed and cannot be replaced safely");
	}
}

async function captureFile(path: string): Promise<FileSnapshot> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new SafePathError("ownership-conflict", "Managed file identity is unsafe");
		const bytes = await readFile(path);
		return { path, bytes, digest: digest(bytes), dev: info.dev, ino: info.ino, mode: info.mode, nlink: info.nlink };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, bytes: null, digest: null, dev: null, ino: null, mode: null, nlink: null };
		throw error;
	}
}

async function revalidateFile(snapshot: FileSnapshot): Promise<void> {
	if (snapshot.bytes === null) {
		try {
			await lstat(snapshot.path);
			throw new SafePathError("ownership-conflict", "Managed file appeared during the operation");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
	const current = await captureFile(snapshot.path);
	if (current.dev !== snapshot.dev || current.ino !== snapshot.ino || current.mode !== snapshot.mode
		|| current.nlink !== snapshot.nlink || current.digest !== snapshot.digest) {
		throw new SafePathError("ownership-conflict", "Managed file changed during the operation");
	}
}

async function adoptExactManifest(root: string, target: string, staged: FileSnapshot): Promise<FileSnapshot> {
	await captureProjectPath(root, portablePath(root, target));
	const current = await captureFile(target);
	if (current.bytes === null || current.dev !== staged.dev || current.ino !== staged.ino
		|| current.mode !== staged.mode || current.nlink !== staged.nlink || current.digest !== staged.digest) {
		throw new SafePathError("ownership-conflict", "Committed manifest is not the exact staged file");
	}
	return current;
}

async function adoptPartialManifestHardLink(
	root: string,
	stagedPath: string,
	target: string,
	expected: FileSnapshot,
): Promise<FileSnapshot | null> {
	let stagedInfo: Awaited<ReturnType<typeof lstat>>;
	let targetInfo: Awaited<ReturnType<typeof lstat>>;
	try {
		[stagedInfo, targetInfo] = await Promise.all([lstat(stagedPath), lstat(target)]);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	if (!stagedInfo.isFile() || stagedInfo.isSymbolicLink() || !targetInfo.isFile() || targetInfo.isSymbolicLink()
		|| stagedInfo.dev !== targetInfo.dev || stagedInfo.ino !== targetInfo.ino
		|| targetInfo.dev !== expected.dev || targetInfo.ino !== expected.ino
		|| targetInfo.mode !== expected.mode || targetInfo.nlink !== 2
		|| digest(await readFile(target)) !== expected.digest) return null;
	const canonicalTarget = await realpath(target);
	const targetRelative = relative(root, target);
	if (canonicalTarget !== target || targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
		throw new SafePathError("ownership-conflict", "Partially committed manifest escaped the project");
	}
	await rm(stagedPath);
	const parent = await open(dirname(stagedPath), "r");
	try { await parent.sync(); } finally { await parent.close(); }
	return await adoptExactManifest(root, target, expected);
}

async function assertAbsent(path: string): Promise<void> {
	try {
		await lstat(path);
		throw new SafePathError("ownership-conflict", "Clone destination already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}

async function writeStaged(path: string, bytes: Buffer): Promise<void> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, "wx", 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		try { await handle?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		try { await rm(path, { force: true }); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "Staged file cleanup failed");
		throw error;
	}
}

async function writeNewAtomic(path: string, bytes: Buffer): Promise<void> {
	const staged = join(dirname(path), `.${basename(path)}.omcs-${randomUUID()}`);
	await writeStaged(staged, bytes);
	let linked = false;
	try {
		await link(staged, path);
		linked = true;
		await rm(staged);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		let stagedRemoved = false;
		try { await rm(staged, { force: true }); stagedRemoved = true; } catch (cleanupError) { cleanupErrors.push(cleanupError); }
		if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "Atomic backup cleanup failed");
		if (linked && stagedRemoved) return;
		throw error;
	}
}

async function commitManifestDefault(staged: string, target: string, existed: boolean): Promise<void> {
	if (existed) {
		await rename(staged, target);
		return;
	}
	await link(staged, target);
	await rm(staged);
}

async function assertOwned(path: OwnedPath): Promise<void> {
	const info = await lstat(path.path);
	if (!info.isFile() && !info.isDirectory()) throw new SafePathError("ownership-conflict", "Owned path type changed");
	if (info.isSymbolicLink() || info.dev !== path.dev || info.ino !== path.ino) throw new SafePathError("ownership-conflict", "Owned path identity changed");
	if (info.isFile() && info.nlink !== 1) throw new SafePathError("ownership-conflict", "Owned file became hard-linked");
}

async function removeTree(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink()) throw new SafePathError("ownership-conflict", "Owned clone contains a symbolic link");
	if (info.isDirectory()) {
		await chmod(path, 0o700);
		for (const child of await readdir(path)) await removeTree(join(path, child));
		await rmdir(path);
		return;
	}
	if (!info.isFile() || info.nlink !== 1) throw new SafePathError("ownership-conflict", "Owned clone file identity is unsafe");
	await chmod(path, 0o600);
	await rm(path);
}

async function makeReadOnly(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) throw new SafePathError("ownership-conflict", "Clone contains unsafe links");
	if (info.isDirectory()) {
		for (const child of await readdir(path)) await makeReadOnly(join(path, child));
		await chmod(path, 0o555);
	} else if (info.isFile()) await chmod(path, 0o444);
}

async function removeCreatedDirectories(created: readonly string[]): Promise<void> {
	for (const path of [...created].reverse()) {
		try { await rmdir(path); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
		}
	}
}

export async function cloneDependency(
	input: CloneDependencyInput,
	dependencies: CloneDependencies = {},
): Promise<ToolResult<CloneRecord>> {
	let temporaryClone: string | undefined;
	let stagedManifest: string | undefined;
	let destinationOwner: OwnedPath | undefined;
	let moveAttempted = false;
	let repositorySnapshot: Awaited<ReturnType<typeof scanTree>> | undefined;
	let backupOwner: OwnedPath | undefined;
	let manifestOwner: FileSnapshot | undefined;
	let manifestCommitAttempted = false;
	let manifestRestored = false;
	let lock: OwnedLock | undefined;
	let sourceTree: Awaited<ReturnType<typeof scanTree>> | undefined;
	let manifestSnapshot: FileSnapshot | undefined;
	let previousManifest: CloneManifest | undefined;
	let previousManifestBytes: Buffer | null = null;
	let nextManifestBytes: Buffer | undefined;
	const createdDirectories: string[] = [];
	const cleanupErrors: unknown[] = [];
	let primaryError: unknown;
	let success: CloneRecord | undefined;
	let projectRoot: string | undefined;
	const removePath = dependencies.removePath ?? removeTree;
	try {
		const root = await canonicalProjectRoot(input.root);
		projectRoot = root;
		if (!DESTINATION_PATTERN.test(input.destination)) throw new SafePathError("path-outside-project", "Clone destination must be one name beneath .omcs/clonedeps/repos");
		const source = await sourceArgument(input, root);
		sourceTree = source.snapshot;
		const metadataDirectory = await ensureSafeDirectory(root, ".omcs/clonedeps");
		createdDirectories.push(...metadataDirectory.created);
		const cloneDirectory = await ensureSafeDirectory(root, ".omcs/clonedeps/repos");
		createdDirectories.push(...cloneDirectory.created);
		lock = await acquireOwnedLock(join(metadataDirectory.path, ".lock"), dependencies);
		const destination = join(cloneDirectory.path, input.destination);
		const repository = join(destination, "repository");
		await assertAbsent(destination);

		const manifestPath = join(metadataDirectory.path, "manifest.json");
		manifestSnapshot = await captureFile(manifestPath);
		previousManifestBytes = manifestSnapshot.bytes;
		previousManifest = previousManifestBytes
			? parseManifest(previousManifestBytes)
			: { owner: "oh-my-codex-slim", schemaVersion: 1, repositories: [] };
		const managedPath = portablePath(root, repository);
		if (previousManifest.repositories.some((record) => record.path === managedPath)) throw new SafePathError("ownership-conflict", "Clone manifest already owns the destination");

		const runner = dependencies.run ?? defaultRunner;
		const git = await verifiedGitExecutable(dependencies.gitExecutable);
		const environment = gitEnvironment(source.protocol);
		temporaryClone = join(cloneDirectory.path, `.omcs-clone-${input.destination}-${process.pid}-${randomUUID()}`);
		await runner(
			git,
			["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--no-hardlinks", "--", source.value, temporaryClone],
			{ cwd: root, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: environment },
		);
		const requestedRevision = input.revision?.trim() || "HEAD";
		const { stdout } = await runner(
			git,
			["rev-parse", "--verify", "--end-of-options", `${requestedRevision}^{commit}`],
			{ cwd: temporaryClone, timeout: 30_000, env: environment },
		);
		const immutableRevision = stdout.trim().toLowerCase();
		if (!/^[0-9a-f]{40,64}$/.test(immutableRevision)) throw new Error("non-immutable revision");
		await runner(
			git,
			["-c", "core.hooksPath=/dev/null", "checkout", "--detach", immutableRevision],
			{ cwd: temporaryClone, timeout: 30_000, env: environment },
		);
		await scanTree(temporaryClone);

		const record = { path: managedPath, url: input.url, revision: immutableRevision };
		const nextManifest: CloneManifest = {
			owner: "oh-my-codex-slim",
			schemaVersion: 1,
			repositories: [...previousManifest.repositories, record].sort((left, right) => left.path.localeCompare(right.path)),
		};
		nextManifestBytes = Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`);
		stagedManifest = join(metadataDirectory.path, `.manifest.omcs-${process.pid}-${randomUUID()}`);
		await writeStaged(stagedManifest, nextManifestBytes);
		const metadataSnapshot = await captureProjectPath(root, ".omcs/clonedeps");
		const cloneRootSnapshot = await captureProjectPath(root, ".omcs/clonedeps/repos");

		await dependencies.beforeCommit?.();
		if (sourceTree) await revalidateTree(sourceTree);
		await revalidateProjectPath(metadataSnapshot);
		await revalidateProjectPath(cloneRootSnapshot);
		await revalidateFile(manifestSnapshot);
		await assertAbsent(destination);

		await (dependencies.reserveDestination ?? ((path: string) => mkdir(path, { mode: 0o700 })))(destination);
		const destinationInfo = await lstat(destination);
		destinationOwner = { path: destination, dev: destinationInfo.dev, ino: destinationInfo.ino };
		await assertOwned(destinationOwner);
		await revalidateFile(manifestSnapshot);
		await assertAbsent(repository);
		const stagedRepositoryPath = temporaryClone;
		const stagedRepository = await scanTree(stagedRepositoryPath);
		moveAttempted = true;
		try {
			await (dependencies.moveClone ?? rename)(stagedRepositoryPath, repository);
			await dependencies.afterRepositoryMove?.(repository);
			repositorySnapshot = await adoptExactMovedTree(root, stagedRepositoryPath, repository, stagedRepository);
			temporaryClone = undefined;
		} catch (moveError) {
			try {
				await revalidateTree(stagedRepository);
				moveAttempted = false;
				throw moveError;
			} catch (stagedError) {
				if (stagedError === moveError) throw stagedError;
				if ((stagedError as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(stagedError);
			}
			try {
				repositorySnapshot = await adoptExactMovedTree(root, stagedRepositoryPath, repository, stagedRepository);
				temporaryClone = undefined;
			} catch (adoptionError) {
				if (adoptionError instanceof SafePathError && adoptionError.code === "ownership-conflict") throw adoptionError;
				if ((adoptionError as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(adoptionError);
			}
			throw moveError;
		}
		await makeReadOnly(repository);
		repositorySnapshot = await scanTree(repository);

		if (previousManifestBytes) {
			await revalidateFile(manifestSnapshot);
			const stamp = (input.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, "-");
			const backupPath = `${manifestPath}.backup-${stamp}`;
			try {
				await (dependencies.createBackup ?? writeNewAtomic)(backupPath, previousManifestBytes);
			} catch (backupError) {
				try {
					const backupInfo = await lstat(backupPath);
					if (backupInfo.isFile() && !backupInfo.isSymbolicLink() && backupInfo.nlink === 1
						&& digest(await readFile(backupPath)) === digest(previousManifestBytes)) {
						backupOwner = { path: backupPath, dev: backupInfo.dev, ino: backupInfo.ino };
					}
				} catch (adoptionError) {
					if ((adoptionError as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(adoptionError);
				}
				throw backupError;
			}
			const backupInfo = await lstat(backupPath);
			backupOwner = { path: backupPath, dev: backupInfo.dev, ino: backupInfo.ino };
		}
		await revalidateFile(manifestSnapshot);
		const stagedManifestPath = stagedManifest;
		const stagedManifestSnapshot = await captureFile(stagedManifestPath);
		manifestCommitAttempted = true;
		try {
			await (dependencies.commitManifest ?? commitManifestDefault)(stagedManifestPath, manifestPath, previousManifestBytes !== null);
			await dependencies.afterManifestCommit?.(manifestPath);
			manifestOwner = await adoptExactManifest(root, manifestPath, stagedManifestSnapshot);
			stagedManifest = undefined;
			await dependencies.afterManifestAdoption?.(manifestPath);
		} catch (commitError) {
			try {
				const partialOwner = await adoptPartialManifestHardLink(root, stagedManifestPath, manifestPath, stagedManifestSnapshot);
				if (partialOwner) {
					manifestOwner = partialOwner;
					stagedManifest = undefined;
					throw commitError;
				}
			} catch (partialError) {
				if (partialError === commitError) throw partialError;
				if (partialError instanceof SafePathError && partialError.code === "ownership-conflict") throw partialError;
				cleanupErrors.push(partialError);
			}
			try {
				const stillStaged = await captureFile(stagedManifestPath);
				if (stillStaged.dev === stagedManifestSnapshot.dev && stillStaged.ino === stagedManifestSnapshot.ino
					&& stillStaged.digest === stagedManifestSnapshot.digest) {
					manifestCommitAttempted = false;
					throw commitError;
				}
			} catch (stagedError) {
				if (stagedError === commitError) throw stagedError;
				if ((stagedError as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(stagedError);
			}
			try {
				manifestOwner = await adoptExactManifest(root, manifestPath, stagedManifestSnapshot);
				stagedManifest = undefined;
			} catch (adoptionError) {
				if (adoptionError instanceof SafePathError && adoptionError.code === "ownership-conflict") throw adoptionError;
				if ((adoptionError as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(adoptionError);
			}
			throw commitError;
		}
		await releaseOwnedLock(lock);
		lock = undefined;
		success = record;
	} catch (error) {
		primaryError = error;
	} finally {
		if (primaryError && manifestOwner && manifestSnapshot && nextManifestBytes) {
			try {
				await revalidateFile(manifestOwner);
				if (previousManifestBytes) {
					const rollback = `${manifestOwner.path}.rollback-${randomUUID()}`;
					await writeStaged(rollback, previousManifestBytes);
					await chmod(rollback, (manifestSnapshot.mode ?? 0o600) & 0o777);
					await rename(rollback, manifestOwner.path);
				} else await rm(manifestOwner.path);
				manifestRestored = true;
			} catch (error) { cleanupErrors.push(error); }
		}
		if (primaryError && destinationOwner) {
			try {
				await assertOwned(destinationOwner);
				if (!moveAttempted) {
					if ((await readdir(destinationOwner.path)).length !== 0) throw new SafePathError("ownership-conflict", "Owned destination gained unknown content");
					await removePath(destinationOwner.path);
				} else if (repositorySnapshot) {
					if ((await readdir(destinationOwner.path)).sort().join("\n") !== "repository") throw new SafePathError("ownership-conflict", "Owned destination gained unknown content");
					const repositoryRoot = repositorySnapshot[0]?.path;
					if (!projectRoot || !repositoryRoot) throw new SafePathError("ownership-conflict", "Owned repository snapshot is incomplete");
					await adoptExactMovedTree(projectRoot, repositoryRoot, repositoryRoot, repositorySnapshot);
					await removePath(destinationOwner.path);
				}
			} catch (error) { cleanupErrors.push(error); }
		}
		if (primaryError && backupOwner && (!manifestCommitAttempted || (manifestOwner && manifestRestored))) {
			try { await assertOwned(backupOwner); await rm(backupOwner.path); } catch (error) { cleanupErrors.push(error); }
		}
		if (temporaryClone) {
			try { await removeTree(temporaryClone); } catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error);
			}
		}
		if (stagedManifest) {
			try { await rm(stagedManifest); } catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error);
			}
		}
		if (lock) {
			try { await releaseOwnedLock(lock); } catch (error) { cleanupErrors.push(error); }
		}
		if (primaryError) {
			try { await removeCreatedDirectories(createdDirectories); } catch (error) { cleanupErrors.push(error); }
		}
	}
	if (primaryError || cleanupErrors.length > 0) {
		const error = cleanupErrors.length > 0
			? new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "Clone transaction rollback failed")
			: primaryError;
		return errorResult(error, "clone-failed");
	}
	return { ok: true, data: success as CloneRecord };
}
