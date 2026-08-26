import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, rm, rmdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

import { AGENT_CATALOG } from "../agents/catalog.js";

const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_SKILLS = 8;
const MAX_AGENTS = 8;
const MAX_VERIFICATION = 32;
const MAX_COMMAND_LENGTH = 160;

const PROFILES = new Set(["auto", "fast", "thorough", "council"]);
const ROUTES = new Set(["solo", "delegate", "audit", "full"]);
const SKILLS = new Set(["context", "codebase-design", "research", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"]);
const AGENTS = new Set(AGENT_CATALOG.map((agent) => agent.name));
const OUTCOMES = new Set(["passed", "failed"]);
const VERDICTS = new Set(["ship", "fix-first", "rethink"]);
const FORBIDDEN_KEY = /token|secret|password|credential|authorization|cookie|api[_-]?key|provider/i;
const FORBIDDEN_COMMAND = /(?:[\u0000-\u001f\u007f]|(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%|(?:^|\s)~(?:[/\\]|$)|(?:^|\s)\/(?:Users|home)(?:\/|$)|(?:^|\s)[A-Za-z]:[\\/]|\\\\|\b(?:token|secret|password|credential|authorization|cookie|api[_-]?key|provider)\b|\b[a-z][a-z0-9+.-]*:\/\/[^/\s@]*@)/i;
const SAFE_COMMAND_LABEL = /^[A-Za-z0-9][A-Za-z0-9 .:/_@+=,-]*$/;
const INLINE_CODE_COMMAND = /(?:^|\s)(?:node|bun|deno)\s+(?:-e|--eval)(?:\s|$)/i;

export interface OrchestrationReceipt {
	schemaVersion: 1;
	profile: "auto" | "fast" | "thorough" | "council";
	route: "solo" | "delegate" | "audit" | "full";
	skills: string[];
	agents: string[];
	approval: "material-decisions";
	verification: Array<{ command: string; outcome: "passed" | "failed" }>;
	review?: { verdict: "ship" | "fix-first" | "rethink" };
}

interface Identity { dev: number; ino: number }
interface DirectoryGuard extends Identity { path: string; handle: FileHandle }
interface PrivateStage { path: string; directory: DirectoryGuard; file: string }

function refuses(message: string): Error {
	return new Error(`OMCS refuses unsafe receipt: ${message}`);
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAlreadyPresent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function sameIdentity(left: Identity, right: Identity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function assertNoSensitiveKeys(value: unknown, visited = new Set<object>()): void {
	if (typeof value !== "object" || value === null || visited.has(value)) return;
	visited.add(value);
	if (Array.isArray(value)) {
		for (const item of value) assertNoSensitiveKeys(item, visited);
		return;
	}
	for (const key of Object.keys(value)) {
		if (FORBIDDEN_KEY.test(key)) throw refuses("receipt contains a forbidden field");
		assertNoSensitiveKeys((value as Record<string, unknown>)[key], visited);
	}
}

function isUnique(values: readonly string[]): boolean {
	return new Set(values).size === values.length;
}

function validCatalogArray(value: unknown, catalog: ReadonlySet<string>, limit: number): value is string[] {
	return Array.isArray(value)
		&& value.length <= limit
		&& value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 64 && catalog.has(item))
		&& isUnique(value);
}

function validCommand(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_COMMAND_LENGTH
		&& SAFE_COMMAND_LABEL.test(value) && !FORBIDDEN_COMMAND.test(value) && !INLINE_CODE_COMMAND.test(value);
}

function validateReceipt(value: unknown): OrchestrationReceipt {
	assertNoSensitiveKeys(value);
	if (!isPlainRecord(value) || !hasOnlyKeys(value, value.review === undefined
		? ["schemaVersion", "profile", "route", "skills", "agents", "approval", "verification"]
		: ["schemaVersion", "profile", "route", "skills", "agents", "approval", "verification", "review"])) {
		throw refuses("receipt schema is invalid");
	}
	if (value.schemaVersion !== 1 || typeof value.profile !== "string" || !PROFILES.has(value.profile)
		|| typeof value.route !== "string" || !ROUTES.has(value.route)
		|| !validCatalogArray(value.skills, SKILLS, MAX_SKILLS)
		|| !validCatalogArray(value.agents, AGENTS, MAX_AGENTS)
		|| value.approval !== "material-decisions"
		|| !Array.isArray(value.verification) || value.verification.length > MAX_VERIFICATION) {
		throw refuses("receipt schema is invalid");
	}
	for (const verification of value.verification) {
		if (!isPlainRecord(verification) || !hasOnlyKeys(verification, ["command", "outcome"])
			|| !validCommand(verification.command) || typeof verification.outcome !== "string" || !OUTCOMES.has(verification.outcome)) {
			throw refuses("receipt verification is invalid");
		}
	}
	if (value.review !== undefined && (!isPlainRecord(value.review) || !hasOnlyKeys(value.review, ["verdict"])
		|| typeof value.review.verdict !== "string" || !VERDICTS.has(value.review.verdict))) {
		throw refuses("receipt review is invalid");
	}
	return value as unknown as OrchestrationReceipt;
}

function renderReceipt(input: unknown): Buffer {
	const receipt = validateReceipt(input);
	const canonical: OrchestrationReceipt = {
		schemaVersion: 1,
		profile: receipt.profile,
		route: receipt.route,
		skills: [...receipt.skills],
		agents: [...receipt.agents],
		approval: "material-decisions",
		verification: receipt.verification.map(({ command, outcome }) => ({ command, outcome })),
		...(receipt.review === undefined ? {} : { review: { verdict: receipt.review.verdict } }),
	};
	const bytes = Buffer.from(`${JSON.stringify(canonical, null, "\t")}\n`, "utf8");
	if (bytes.byteLength > MAX_RECEIPT_BYTES) throw refuses("receipt exceeds the size limit");
	return bytes;
}

async function assertSafeExistingDirectory(path: string): Promise<string> {
	const resolved = resolve(path);
	const root = parse(resolved).root;
	let current = root;
	for (const component of relative(root, resolved).split(sep).filter(Boolean)) {
		current = join(current, component);
		let state;
		try { state = await lstat(current); } catch (error) {
			if (isMissing(error)) throw refuses("receipt root is missing");
			throw error;
		}
		if ((current === "/var" || current === "/tmp") && state.isSymbolicLink()) continue;
		if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt ancestor");
	}
	return resolved;
}

async function openDirectoryGuard(path: string, expected?: Identity): Promise<DirectoryGuard> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
	try {
		const descriptor = await handle.stat();
		const named = await lstat(path);
		if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(descriptor, named)
			|| (expected !== undefined && (!sameIdentity(descriptor, expected) || !sameIdentity(named, expected)))) {
			throw refuses("unsafe receipt directory");
		}
		return { path, handle, dev: descriptor.dev, ino: descriptor.ino };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function verifyDirectory(guard: DirectoryGuard): Promise<void> {
	const descriptor = await guard.handle.stat();
	const named = await lstat(guard.path);
	if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(descriptor, guard) || !sameIdentity(named, guard)) {
		throw refuses("receipt directory changed");
	}
}

async function ensurePrivateChild(parent: DirectoryGuard, name: string): Promise<DirectoryGuard> {
	const path = join(parent.path, name);
	await verifyDirectory(parent);
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if (!isAlreadyPresent(error)) throw error;
	}
	const state = await lstat(path);
	if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt directory entry");
	await chmod(path, 0o700);
	await verifyDirectory(parent);
	return openDirectoryGuard(path, state);
}

async function createPrivateStage(parent: DirectoryGuard): Promise<PrivateStage> {
	await verifyDirectory(parent);
	const path = join(parent.path, `.receipt-${randomUUID()}.stage`);
	await mkdir(path, { mode: 0o700 });
	await chmod(path, 0o700);
	const state = await lstat(path);
	if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt staging directory");
	await verifyDirectory(parent);
	const directory = await openDirectoryGuard(path, state);
	return { path, directory, file: join(path, "receipt.json") };
}

async function stageReceipt(stage: PrivateStage, bytes: Buffer): Promise<Identity> {
	await verifyDirectory(stage.directory);
	let handle: FileHandle | undefined;
	try {
		handle = await open(stage.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
		await handle.chmod(0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		const state = await handle.stat();
		if (!state.isFile() || state.nlink !== 1 || state.size !== bytes.byteLength) throw refuses("unsafe staged receipt");
		await handle.close();
		handle = undefined;
		await verifyDirectory(stage.directory);
		return { dev: state.dev, ino: state.ino };
	} catch (error) {
		await handle?.close().catch(() => undefined);
		throw error;
	}
}

async function verifyStagedReceipt(stage: PrivateStage, expected: Identity, bytes: Buffer): Promise<void> {
	await verifyDirectory(stage.directory);
	const namedBefore = await lstat(stage.file);
	if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== 1 || !sameIdentity(namedBefore, expected)) throw refuses("staged receipt changed");
	const handle = await open(stage.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat();
		const actual = await handle.readFile();
		const after = await handle.stat();
		const namedAfter = await lstat(stage.file);
		if (!before.isFile() || before.nlink !== 1 || !sameIdentity(before, expected) || !sameIdentity(before, after)
			|| !sameIdentity(after, namedAfter) || namedAfter.isSymbolicLink() || !actual.equals(bytes)) {
			throw refuses("staged receipt changed");
		}
	} finally { await handle.close(); }
	await verifyDirectory(stage.directory);
}

function receiptName(): string {
	return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
}

async function cleanupStage(stage: PrivateStage | undefined, expected?: Identity): Promise<void> {
	if (!stage) return;
	try {
		await verifyDirectory(stage.directory);
		if (expected !== undefined) {
			const state = await lstat(stage.file).catch((error: unknown) => isMissing(error) ? null : Promise.reject(error));
			if (state !== null) {
				if (state.isSymbolicLink() || !state.isFile() || !sameIdentity(state, expected)) return;
				await rm(stage.file);
			}
		}
		await verifyDirectory(stage.directory);
		await stage.directory.handle.close();
		const named = await lstat(stage.path);
		if (named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(named, stage.directory)) return;
		await rmdir(stage.path);
	} catch {
		await stage.directory.handle.close().catch(() => undefined);
	}
}

/** Writes a new advisory receipt without serializing runtime, path, or secret data. */
export async function writeRunReceipt(root: string, receipt: OrchestrationReceipt): Promise<string> {
	const bytes = renderReceipt(receipt);
	const safeRoot = await assertSafeExistingDirectory(root);
	let rootDirectory: DirectoryGuard | undefined;
	let omcsDirectory: DirectoryGuard | undefined;
	let runsDirectory: DirectoryGuard | undefined;
	let stage: PrivateStage | undefined;
	let staged: Identity | undefined;
	try {
		rootDirectory = await openDirectoryGuard(safeRoot);
		omcsDirectory = await ensurePrivateChild(rootDirectory, ".omcs");
		runsDirectory = await ensurePrivateChild(omcsDirectory, "runs");
		stage = await createPrivateStage(runsDirectory);
		staged = await stageReceipt(stage, bytes);
		await verifyStagedReceipt(stage, staged, bytes);
		await verifyDirectory(runsDirectory);
		const target = join(runsDirectory.path, receiptName());
		await link(stage.file, target);
		await verifyDirectory(runsDirectory);
		const visible = await lstat(target);
		if (visible.isSymbolicLink() || !visible.isFile() || visible.nlink !== 2 || !sameIdentity(visible, staged) || (visible.mode & 0o777) !== 0o600) {
			throw refuses("receipt commit changed");
		}
		await runsDirectory.handle.sync();
		await rm(stage.file);
		await verifyDirectory(stage.directory);
		await stage.directory.handle.close();
		const stageState = await lstat(stage.path);
		if (stageState.isSymbolicLink() || !stageState.isDirectory() || !sameIdentity(stageState, stage.directory)) throw refuses("receipt staging directory changed");
		await rmdir(stage.path);
		stage = undefined;
		const final = await lstat(target);
		if (final.isSymbolicLink() || !final.isFile() || final.nlink !== 1 || !sameIdentity(final, staged) || (final.mode & 0o777) !== 0o600) {
			throw new Error("OMCS receipt committed but needs recovery");
		}
		await runsDirectory.handle.sync();
		return target;
	} finally {
		await cleanupStage(stage, staged);
		await runsDirectory?.handle.close().catch(() => undefined);
		await omcsDirectory?.handle.close().catch(() => undefined);
		await rootDirectory?.handle.close().catch(() => undefined);
	}
}
