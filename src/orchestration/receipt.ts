import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm, rmdir, type FileHandle } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";
import { AGENT_CATALOG } from "../agents/catalog.js";

const MAX_RECEIPT_BYTES = 16 * 1024;
const PROFILES = new Set(["auto", "fast", "thorough", "council"]);
const ROUTES = new Set(["solo", "delegate", "audit", "full"]);
const SKILLS = new Set(["context", "codebase-design", "research", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"]);
const AGENTS = new Set(AGENT_CATALOG.map((agent) => agent.name));
const OUTCOMES = new Set(["passed", "failed"]);
const VERDICTS = new Set(["ship", "fix-first", "rethink"]);
const TOOLS = new Set(["npm", "node", "git", "omcs", "tsc", "biome"]);
const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.json$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const BAD_KEY = /token|secret|password|credential|authorization|cookie|api[_-]?key|provider|model|endpoint/i;
const BAD_LABEL = /token|secret|password|credential|authorization|cookie|api[_-]?key|provider|model|endpoint|prompt|response|output|stdout|stderr/i;
const ENV_ARGUMENT = /env|dotenv|node_options|process\.env|\.env/i;
const SAFE_ARG = /^(?:--?[A-Za-z][A-Za-z0-9._:/=-]*|[A-Za-z0-9][A-Za-z0-9._:/=-]*)$/;
const PROVIDERS = ["open" + "ai", "anth" + "ropic", "gemi" + "ni", "cla" + "ude", "az" + "ure", "bed" + "rock", "ver" + "tex", "gr" + "oq", "mistr" + "al", "coh" + "ere", "tog" + "ether", "deep" + "seek", "oll" + "ama", "x" + "ai"];
const INLINE = new Set(["-c", "-e", "--eval", "--execute", "--input-type"]);

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

type Phase = "ensure-private-directory" | "stage-directory" | "stage-file" | "publish" | "cleanup-file" | "cleanup-directory";
interface Hooks {
	nextUuid?: () => string;
	nextReceiptName?: () => string;
	beforePathMutation?: (phase: Phase, path: string) => Promise<void>;
	beforeStageWrite?: () => Promise<void>;
	afterVisibleCommit?: (path: string) => Promise<void>;
	beforeCleanup?: (path: string) => Promise<void>;
}
interface Identity { dev: number; ino: number }
interface Guard extends Identity { path: string; handle: FileHandle }
interface Stage { path: string; parent: Guard; directory: Guard; file: string }
let hooks: Hooks | undefined;

/** Test-only deterministic fault injection. */
export function __setWriteRunReceiptHooksForTest(value?: Hooks): void { hooks = value; }
function refuses(message: string): Error { return new Error(`OMCS refuses unsafe receipt: ${message}`); }
function committed(cause: unknown): Error { return new Error("OMCS receipt committed; recovery is required", { cause }); }
function same(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"; }
function exists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every((key) => keys.includes(key)); }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }

function noSensitiveKeys(value: unknown, seen = new Set<object>()): void {
	if (typeof value !== "object" || value === null || seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) { for (const item of value) noSensitiveKeys(item, seen); return; }
	for (const key of Object.keys(value)) {
		if (BAD_KEY.test(key)) throw refuses("receipt contains a forbidden field");
		noSensitiveKeys((value as Record<string, unknown>)[key], seen);
	}
}
function catalog(value: unknown, values: ReadonlySet<string>, limit: number): value is string[] {
	return Array.isArray(value) && value.length <= limit && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 64 && values.has(item)) && unique(value);
}
function command(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 160 || value.trim() !== value) return false;
	const tokens = value.split(" ");
	if (!TOOLS.has(tokens[0] ?? "")) return false;
	return tokens.every((token, index) => {
		const lower = token.toLowerCase();
		return token.length > 0 && SAFE_ARG.test(token) && !BAD_LABEL.test(lower) && !ENV_ARGUMENT.test(lower) && !PROVIDERS.some((provider) => lower.includes(provider))
			&& !token.startsWith("/") && !token.startsWith("~") && !token.startsWith("\\") && !token.includes("//") && !token.includes("..")
			&& !token.includes(":") && !(token.includes("=") && !token.startsWith("--")) && !INLINE.has(lower) && token !== "-"
			&& (index !== 0 || TOOLS.has(token));
	});
}
function validate(value: unknown): OrchestrationReceipt {
	noSensitiveKeys(value);
	if (!record(value) || !exact(value, value.review === undefined ? ["schemaVersion", "profile", "route", "skills", "agents", "approval", "verification"] : ["schemaVersion", "profile", "route", "skills", "agents", "approval", "verification", "review"])) throw refuses("receipt schema is invalid");
	if (value.schemaVersion !== 1 || typeof value.profile !== "string" || !PROFILES.has(value.profile) || typeof value.route !== "string" || !ROUTES.has(value.route) || !catalog(value.skills, SKILLS, 8) || !catalog(value.agents, AGENTS, 8) || value.approval !== "material-decisions" || !Array.isArray(value.verification) || value.verification.length > 32) throw refuses("receipt schema is invalid");
	for (const item of value.verification) if (!record(item) || !exact(item, ["command", "outcome"]) || !command(item.command) || typeof item.outcome !== "string" || !OUTCOMES.has(item.outcome)) throw refuses("receipt verification is invalid");
	if (value.review !== undefined && (!record(value.review) || !exact(value.review, ["verdict"]) || typeof value.review.verdict !== "string" || !VERDICTS.has(value.review.verdict))) throw refuses("receipt review is invalid");
	return value as unknown as OrchestrationReceipt;
}
function render(value: unknown): Buffer {
	const input = validate(value);
	const canonical: OrchestrationReceipt = { schemaVersion: 1, profile: input.profile, route: input.route, skills: [...input.skills], agents: [...input.agents], approval: "material-decisions", verification: input.verification.map(({ command: label, outcome }) => ({ command: label, outcome })), ...(input.review === undefined ? {} : { review: { verdict: input.review.verdict } }) };
	const bytes = Buffer.from(`${JSON.stringify(canonical, null, "\t")}\n`, "utf8");
	if (bytes.byteLength > MAX_RECEIPT_BYTES) throw refuses("receipt exceeds the size limit");
	return bytes;
}

async function safeRoot(path: string): Promise<string> {
	const resolved = resolve(path); const root = parse(resolved).root; let current = root;
	for (const component of relative(root, resolved).split(sep).filter(Boolean)) {
		current = join(current, component);
		let state; try { state = await lstat(current); } catch (error) { if (missing(error)) throw refuses("receipt root is missing"); throw error; }
		if ((current === "/var" || current === "/tmp") && state.isSymbolicLink()) continue;
		if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt ancestor");
	}
	return resolved;
}
async function openGuard(path: string, expected?: Identity): Promise<Guard> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
	try {
		const descriptor = await handle.stat(); const named = await lstat(path);
		if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !same(descriptor, named) || (expected !== undefined && (!same(descriptor, expected) || !same(named, expected)))) throw refuses("unsafe receipt directory");
		return { path, handle, dev: descriptor.dev, ino: descriptor.ino };
	} catch (error) { await handle.close(); throw error; }
}
async function verify(guards: readonly (Guard | undefined)[]): Promise<void> {
	for (const guard of guards) {
		if (!guard) continue;
		const descriptor = await guard.handle.stat(); const named = await lstat(guard.path);
		if (!descriptor.isDirectory() || named.isSymbolicLink() || !named.isDirectory() || !same(descriptor, guard) || !same(named, guard)) throw refuses("receipt directory changed");
	}
}
async function mutate(guards: readonly (Guard | undefined)[], phase: Phase, path: string): Promise<void> {
	await verify(guards); await hooks?.beforePathMutation?.(phase, path); await verify(guards);
}
async function privateChild(parent: Guard, name: string, guards: readonly Guard[]): Promise<Guard> {
	const path = join(parent.path, name);
	await mutate(guards, "ensure-private-directory", path);
	try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (!exists(error)) throw error; }
	await verify(guards);
	const state = await lstat(path);
	if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt directory entry");
	const child = await openGuard(path, state);
	try { await verify([...guards, child]); await child.handle.chmod(0o700); await verify([...guards, child]); return child; } catch (error) { await child.handle.close(); throw error; }
}
function uuid(): string { const value = hooks?.nextUuid?.() ?? randomUUID(); if (!UUID.test(value)) throw refuses("invalid receipt identifier"); return value; }
async function createStage(parent: Guard, guards: readonly Guard[]): Promise<Stage> {
	const path = join(parent.path, `.receipt-${uuid()}.stage`);
	await mutate(guards, "stage-directory", path); await mkdir(path, { mode: 0o700 }); await verify(guards);
	const state = await lstat(path);
	if (state.isSymbolicLink() || !state.isDirectory()) throw refuses("unsafe receipt staging directory");
	const directory = await openGuard(path, state);
	try { await verify([...guards, directory]); await directory.handle.chmod(0o700); await verify([...guards, directory]); return { path, parent, directory, file: join(path, "receipt.json") }; } catch (error) { await directory.handle.close(); throw error; }
}
async function stage(stage: Stage, bytes: Buffer, guards: readonly Guard[]): Promise<Identity> {
	await mutate(guards, "stage-file", stage.file);
	let handle: FileHandle | undefined;
	try {
		handle = await open(stage.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
		await handle.chmod(0o600); await hooks?.beforeStageWrite?.(); await verify(guards); await handle.writeFile(bytes); await handle.sync();
		const state = await handle.stat();
		if (!state.isFile() || state.nlink !== 1 || state.size !== bytes.byteLength || (state.mode & 0o777) !== 0o600) throw refuses("unsafe staged receipt");
		await handle.close(); handle = undefined; await verify(guards); return { dev: state.dev, ino: state.ino };
	} catch (error) { await handle?.close().catch(() => undefined); throw error; }
}
async function verifyStage(stageValue: Stage, expected: Identity, bytes: Buffer, guards: readonly Guard[]): Promise<void> {
	await verify(guards);
	const namedBefore = await lstat(stageValue.file);
	if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== 1 || !same(namedBefore, expected)) throw refuses("staged receipt changed");
	const handle = await open(stageValue.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat(); const actual = await handle.readFile(); const after = await handle.stat(); const namedAfter = await lstat(stageValue.file);
		if (!before.isFile() || before.nlink !== 1 || !same(before, expected) || !same(before, after) || !same(after, namedAfter) || namedAfter.isSymbolicLink() || !actual.equals(bytes)) throw refuses("staged receipt changed");
	} finally { await handle.close(); }
	await verify(guards);
}
function name(): string {
	const value = hooks?.nextReceiptName?.() ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${uuid()}.json`;
	if (!NAME.test(value)) throw refuses("invalid receipt filename");
	return value;
}
async function abort(stageValue: Stage | undefined, guards: readonly Guard[], expected: Identity | undefined): Promise<void> {
	if (!stageValue) return;
	try {
		await verify(guards);
		const file = await lstat(stageValue.file).catch((error: unknown) => missing(error) ? null : Promise.reject(error));
		if (file !== null) {
			if (!expected || file.isSymbolicLink() || !file.isFile() || !same(file, expected)) return;
			await mutate(guards, "cleanup-file", stageValue.file);
			const current = await lstat(stageValue.file);
			if (current.isSymbolicLink() || !current.isFile() || !same(current, expected)) return;
			await rm(stageValue.file);
		}
		await mutate(guards, "cleanup-directory", stageValue.path);
		const named = await lstat(stageValue.path);
		if (named.isSymbolicLink() || !named.isDirectory() || !same(named, stageValue.directory)) return;
		await rmdir(stageValue.path);
	} catch {
		// Unsafe or incomplete staging remains private recovery evidence.
	}
}
async function finish(stageValue: Stage, guards: readonly Guard[], expected: Identity): Promise<void> {
	await hooks?.beforeCleanup?.(stageValue.path);
	await mutate(guards, "cleanup-file", stageValue.file);
	const file = await lstat(stageValue.file);
	if (file.isSymbolicLink() || !file.isFile() || file.nlink !== 2 || !same(file, expected)) throw new Error("OMCS receipt staging source changed after commit");
	await rm(stageValue.file);
	await mutate(guards, "cleanup-directory", stageValue.path);
	const named = await lstat(stageValue.path);
	if (named.isSymbolicLink() || !named.isDirectory() || !same(named, stageValue.directory)) throw new Error("OMCS receipt staging directory changed after commit");
	await rmdir(stageValue.path);
}

/** Writes a new advisory receipt with local-only labels and no hidden execution state. */
export async function writeRunReceipt(root: string, receipt: OrchestrationReceipt): Promise<string> {
	const bytes = render(receipt); const base = await safeRoot(root);
	let rootGuard: Guard | undefined; let omcs: Guard | undefined; let runs: Guard | undefined; let stageValue: Stage | undefined; let staged: Identity | undefined; let visible = false;
	try {
		rootGuard = await openGuard(base); omcs = await privateChild(rootGuard, ".omcs", [rootGuard]); runs = await privateChild(omcs, "runs", [rootGuard, omcs]); stageValue = await createStage(runs, [rootGuard, omcs, runs]);
		const guards = [rootGuard, omcs, runs, stageValue.directory];
		staged = await stage(stageValue, bytes, guards); await verifyStage(stageValue, staged, bytes, guards);
		const target = join(runs.path, name());
		await mutate(guards, "publish", target); await verifyStage(stageValue, staged, bytes, guards); await link(stageValue.file, target); visible = true;
		await verify(guards);
		const published = await lstat(target);
		if (published.isSymbolicLink() || !published.isFile() || published.nlink !== 2 || !same(published, staged) || (published.mode & 0o777) !== 0o600) throw new Error("OMCS receipt commit changed");
		await runs.handle.sync(); await hooks?.afterVisibleCommit?.(target); await finish(stageValue, guards, staged); await stageValue.directory.handle.close(); stageValue = undefined;
		const final = await lstat(target);
		if (final.isSymbolicLink() || !final.isFile() || final.nlink !== 1 || !same(final, staged) || (final.mode & 0o777) !== 0o600) throw new Error("OMCS receipt committed but needs recovery");
		await verify([rootGuard, omcs, runs]); await runs.handle.sync(); return target;
	} catch (error) {
		if (visible) throw committed(error);
		throw error;
	} finally {
		if (!visible) await abort(stageValue, [rootGuard, omcs, runs, stageValue?.directory].filter((guard): guard is Guard => guard !== undefined), staged);
		await stageValue?.directory.handle.close().catch(() => undefined);
		await runs?.handle.close().catch(() => undefined); await omcs?.handle.close().catch(() => undefined); await rootGuard?.handle.close().catch(() => undefined);
	}
}
