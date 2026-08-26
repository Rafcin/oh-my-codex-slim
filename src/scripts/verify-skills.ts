#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../catalog/skills.json" with { type: "json" };

interface SkillDefinition {
	name: string;
	description: string;
}

interface SyncManifest {
	version: 1;
	files: Record<string, string>;
}

interface DesiredTree {
	directories: string[];
	files: Map<string, Buffer>;
}

interface WritePlan {
	target: string;
	bytes: Buffer;
	prior: Buffer | null;
	temporary: string;
}

interface NoticeExpectation {
	heading: string;
	fields: readonly { name: string; line: string }[];
}

export interface SkillSyncOptions {
	repositoryRoot?: string;
}

export interface SkillSyncDependencies {
	stageFile?: (path: string, bytes: Uint8Array) => Promise<void>;
	rename?: (from: string, to: string) => Promise<void>;
	syncDirectory?: (path: string) => Promise<void>;
}

export interface VerifySkillsOptions {
	repositoryRoot?: string;
}

const SKILL_CATALOG = catalog as readonly SkillDefinition[];
const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestName = ".omcs-sync-manifest.json";
const supportingNoticeExpectations: readonly NoticeExpectation[] = [
	{
		heading: "codemap supporting resource: clone-dependency",
		fields: [
			{ name: "repository", line: "- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>" },
			{ name: "source path", line: "- Source path: `src/skills/clonedeps/SKILL.md`" },
			{ name: "revision", line: "- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`" },
			{ name: "license", line: "- License: MIT" },
			{ name: "status", line: "- Status: modified adaptation" },
			{ name: "author", line: "- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)" },
			{ name: "owner", line: "- Repository owner: `alvinunreal`" },
		],
	},
	{
		heading: "deepwork supporting resource: worktrees",
		fields: [
			{ name: "repository", line: "- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>" },
			{ name: "source path", line: "- Source path: `src/skills/worktrees/SKILL.md`" },
			{ name: "revision", line: "- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`" },
			{ name: "license", line: "- License: MIT" },
			{ name: "status", line: "- Status: modified adaptation" },
			{ name: "author", line: "- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)" },
			{ name: "owner", line: "- Repository owner: `alvinunreal`" },
		],
	},
];
const primaryNoticeExpectations: Readonly<Record<string, readonly string[]>> = {
	"ai-slop-cleaner": ["Yeachan-Heo/oh-my-codex", "skills/ai-slop-cleaner/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)", "Yeachan-Heo", "modified adaptation"],
	"codebase-design": ["mattpocock/skills", "skills/engineering/codebase-design/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	codemap: ["alvinunreal/oh-my-opencode-slim", "src/skills/codemap/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)", "alvinunreal", "modified adaptation"],
	"code-review": ["mattpocock/skills", "skills/engineering/code-review/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	context: ["mattpocock/skills", "skills/engineering/grill-with-docs/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	"deep-interview": ["Yeachan-Heo/oh-my-codex", "skills/deep-interview/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)", "Yeachan-Heo", "modified adaptation"],
	deepwork: ["alvinunreal/oh-my-opencode-slim", "src/skills/deepwork/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)", "alvinunreal", "modified adaptation"],
	diagnose: ["mattpocock/skills", "skills/engineering/diagnosing-bugs/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	implement: ["mattpocock/skills", "skills/engineering/implement/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	omcs: ["DannyMac180/sol-advisor", "plugins/sol-advisor/skills/orchestration/SKILL.md", "37b75cad535abdd46531f0227483a8842d045ab8", "Daniel McAteer", "DannyMac180", "modified adaptation"],
	"omcs-orchestrate": ["DannyMac180/sol-advisor", "plugins/sol-advisor/skills/orchestration/SKILL.md", "37b75cad535abdd46531f0227483a8842d045ab8", "Daniel McAteer", "DannyMac180", "compatibility alias"],
	plan: ["Yeachan-Heo/oh-my-codex", "skills/plan/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo (author metadata; the pinned source publishes no separate named copyright line)", "Yeachan-Heo", "modified adaptation"],
	research: ["mattpocock/skills", "skills/engineering/research/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	simplify: ["alvinunreal/oh-my-opencode-slim", "src/skills/simplify/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)", "alvinunreal", "modified adaptation"],
	tdd: ["mattpocock/skills", "skills/engineering/tdd/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock", "modified adaptation"],
	verification: ["alvinunreal/oh-my-opencode-slim", "src/skills/verification-planning/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)", "alvinunreal", "modified adaptation"],
};
const forbiddenTerms = [
	["Lazy", "Codex"],
	["tm", "ux"],
	["zel", "lij"],
	["Clau", "de"],
	["Gem", "ini"],
	["tele", "metry"],
	["ana", "lytics"],
].map((parts) => parts.join("").toLowerCase());

function fail(message: string): never {
	throw new Error(`skill-verification: ${message}`);
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function inspectPath(
	root: string,
	path: string,
	kind: "directory" | "file",
	allowMissing: boolean,
): Promise<"exists" | "missing"> {
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(path);
	if (!isWithin(resolvedRoot, resolvedPath)) fail(`path is outside the managed root: ${resolvedPath}`);
	const rootStat = await lstat(resolvedRoot);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail(`managed root is unsafe: ${resolvedRoot}`);
	const canonicalRoot = await realpath(resolvedRoot);
	const segments = relative(resolvedRoot, resolvedPath).split(sep).filter(Boolean);
	let current = resolvedRoot;
	for (let index = 0; index < segments.length; index += 1) {
		current = join(current, segments[index] ?? "");
		let stat;
		try {
			stat = await lstat(current);
		} catch (error) {
			if (allowMissing && isMissing(error)) return "missing";
			throw error;
		}
		if (stat.isSymbolicLink()) fail(`symbolic links are unsafe in managed skills: ${current}`);
		const final = index === segments.length - 1;
		if (!final && !stat.isDirectory()) fail(`managed path ancestor is not a directory: ${current}`);
		if (final && kind === "directory" && !stat.isDirectory()) fail(`expected a directory: ${current}`);
		if (final && kind === "file" && !stat.isFile()) fail(`expected a regular file: ${current}`);
	}
	const canonical = await realpath(resolvedPath);
	if (!isWithin(canonicalRoot, canonical)) fail(`canonical path is outside the managed root: ${resolvedPath}`);
	return "exists";
}

async function collectDesiredTree(sourceRoot: string): Promise<DesiredTree> {
	await inspectPath(sourceRoot, sourceRoot, "directory", false);
	const directories = new Set<string>();
	const files = new Map<string, Buffer>();
	const walk = async (absolute: string, relativePath: string): Promise<void> => {
		for (const entry of await readdir(absolute, { withFileTypes: true })) {
			const childRelative = relativePath ? join(relativePath, entry.name) : entry.name;
			const child = join(absolute, entry.name);
			if (entry.isSymbolicLink()) fail(`symbolic links are unsafe in canonical skills: ${child}`);
			if (entry.isDirectory()) {
				directories.add(childRelative);
				await inspectPath(sourceRoot, child, "directory", false);
				await walk(child, childRelative);
			} else if (entry.isFile()) {
				await inspectPath(sourceRoot, child, "file", false);
				files.set(childRelative, await readFile(child));
			} else {
				fail(`unsupported canonical skill entry: ${child}`);
			}
		}
	};
	await walk(sourceRoot, "");
	const expectedNames = new Set(SKILL_CATALOG.map((skill) => skill.name));
	const supportedResourceDirectories = new Set(["agents", "assets", "references", "scripts"]);
	for (const relativePath of [...directories, ...files.keys()]) {
		const [, resourceRoot] = relativePath.split(sep);
		if (resourceRoot && resourceRoot !== "SKILL.md" && !supportedResourceDirectories.has(resourceRoot)) {
			fail(`unsupported top-level skill resource: ${relativePath}`);
		}
	}
	const rootEntries = await readdir(sourceRoot, { withFileTypes: true });
	const actualNames = rootEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	if (rootEntries.some((entry) => !entry.isDirectory()) || actualNames.some((name) => !expectedNames.has(name)) || actualNames.length !== expectedNames.size) {
		fail(`source catalog is not the exact approved skill set: ${actualNames.sort().join(", ")}`);
	}
	for (const skill of SKILL_CATALOG) {
		if (!files.has(join(skill.name, "SKILL.md"))) fail(`${skill.name} has no canonical SKILL.md`);
	}
	return {
		directories: [...directories].sort((left, right) => left.split(sep).length - right.split(sep).length || left.localeCompare(right)),
		files,
	};
}

async function readManifest(pluginRoot: string): Promise<{ bytes: Buffer | null; value: SyncManifest | null }> {
	const path = join(pluginRoot, manifestName);
	if (await inspectPath(pluginRoot, path, "file", true) === "missing") return { bytes: null, value: null };
	const bytes = await readFile(path);
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		fail("plugin skill ownership manifest is malformed");
	}
	if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== 1) fail("plugin skill ownership manifest is incompatible");
	const files = (value as { files?: unknown }).files;
	if (typeof files !== "object" || files === null || Array.isArray(files)) fail("plugin skill ownership manifest has no file records");
	for (const [relativePath, hash] of Object.entries(files)) {
		const unsafeSegment = relativePath.split(/[\\/]/).some((segment) => segment === "" || segment === "." || segment === "..");
		if (isAbsolute(relativePath) || unsafeSegment || resolve(pluginRoot, relativePath) !== join(pluginRoot, relativePath) || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
			fail("plugin skill ownership manifest contains an unsafe record");
		}
	}
	return { bytes, value: value as SyncManifest };
}

async function inspectPluginTree(pluginRoot: string, desired: DesiredTree): Promise<Map<string, Buffer>> {
	await inspectPath(pluginRoot, pluginRoot, "directory", false);
	const desiredDirectories = new Set(desired.directories);
	const desiredFiles = new Set(desired.files.keys());
	const current = new Map<string, Buffer>();
	const walk = async (absolute: string, relativePath: string): Promise<void> => {
		for (const entry of await readdir(absolute, { withFileTypes: true })) {
			const childRelative = relativePath ? join(relativePath, entry.name) : entry.name;
			const child = join(absolute, entry.name);
			if (!relativePath && entry.name === manifestName) {
				if (entry.isSymbolicLink() || !entry.isFile()) fail(`plugin ownership manifest is unsafe: ${child}`);
				continue;
			}
			if (entry.isSymbolicLink()) fail(`symbolic links are unsafe in plugin skills: ${child}`);
			if (entry.isDirectory()) {
				if (!desiredDirectories.has(childRelative)) fail(`refusing unknown plugin skill directory: ${childRelative}`);
				await inspectPath(pluginRoot, child, "directory", false);
				await walk(child, childRelative);
			} else if (entry.isFile()) {
				if (!desiredFiles.has(childRelative)) fail(`refusing unknown plugin skill file: ${childRelative}`);
				await inspectPath(pluginRoot, child, "file", false);
				current.set(childRelative, await readFile(child));
			} else {
				fail(`unsupported plugin skill entry: ${child}`);
			}
		}
	};
	await walk(pluginRoot, "");
	return current;
}

function manifestBytes(tree: DesiredTree): Buffer {
	const files = Object.fromEntries([...tree.files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => [path, digest(bytes)]));
	return Buffer.from(`${JSON.stringify({ version: 1, files }, null, 2)}\n`);
}

async function defaultStageFile(path: string, bytes: Uint8Array): Promise<void> {
	let handle;
	try {
		handle = await open(path, "wx", 0o644);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await rm(path, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function defaultSyncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function removeCreatedDirectories(paths: string[]): Promise<void> {
	for (const path of [...paths].reverse()) await rmdir(path).catch((error: unknown) => {
		if (!isMissing(error)) throw error;
	});
}

export async function syncDiscoveryCopies(
	options: SkillSyncOptions = {},
	dependencies: SkillSyncDependencies = {},
): Promise<void> {
	const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
	const sourceRoot = join(repositoryRoot, "skills");
	const pluginRoot = join(repositoryRoot, "plugins", "oh-my-codex-slim", "skills");
	await inspectPath(repositoryRoot, sourceRoot, "directory", false);
	await inspectPath(repositoryRoot, pluginRoot, "directory", false);
	const desired = await collectDesiredTree(sourceRoot);
	const current = await inspectPluginTree(pluginRoot, desired);
	const priorManifest = await readManifest(pluginRoot);
	for (const path of Object.keys(priorManifest.value?.files ?? {})) {
		if (!desired.files.has(path)) fail(`refusing to delete previously managed plugin resource: ${path}`);
	}

	const writes: WritePlan[] = [];
	let temporaryCounter = 0;
	for (const [relativePath, bytes] of [...desired.files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const prior = current.get(relativePath) ?? null;
		if (prior && prior.equals(bytes)) continue;
		if (prior && priorManifest.value?.files[relativePath] !== digest(prior)) fail(`refusing to overwrite unknown plugin skill content: ${relativePath}`);
		const target = join(pluginRoot, relativePath);
		writes.push({ target, bytes, prior, temporary: `${target}.omcs-tmp-${process.pid}-${temporaryCounter += 1}` });
	}
	const desiredManifest = manifestBytes(desired);
	if (!priorManifest.bytes?.equals(desiredManifest)) {
		const target = join(pluginRoot, manifestName);
		writes.push({ target, bytes: desiredManifest, prior: priorManifest.bytes, temporary: `${target}.omcs-tmp-${process.pid}-${temporaryCounter += 1}` });
	}

	const createdDirectories: string[] = [];
	const staged = new Set<string>();
	const applied: WritePlan[] = [];
	const stageFile = dependencies.stageFile ?? defaultStageFile;
	const renameFile = dependencies.rename ?? rename;
	const syncDirectory = dependencies.syncDirectory ?? defaultSyncDirectory;
	try {
		for (const relativePath of desired.directories) {
			const target = join(pluginRoot, relativePath);
			if (await inspectPath(pluginRoot, target, "directory", true) === "missing") {
				await mkdir(target);
				createdDirectories.push(target);
			}
		}
		for (const plan of writes) {
			await inspectPath(pluginRoot, dirname(plan.temporary), "directory", false);
			staged.add(plan.temporary);
			await stageFile(plan.temporary, plan.bytes);
		}
		for (const plan of writes) {
			const state = await inspectPath(pluginRoot, plan.target, "file", true);
			if (plan.prior === null && state === "exists") fail(`managed target appeared during sync: ${relative(pluginRoot, plan.target)}`);
			if (plan.prior !== null && (state === "missing" || !(await readFile(plan.target)).equals(plan.prior))) {
				fail(`managed target changed during sync: ${relative(pluginRoot, plan.target)}`);
			}
			await renameFile(plan.temporary, plan.target);
			staged.delete(plan.temporary);
			applied.push(plan);
			await syncDirectory(dirname(plan.target));
		}
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		for (const path of staged) await rm(path, { force: true }).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
		for (const plan of [...applied].reverse()) {
			let rollbackTemporary: string | undefined;
			try {
				if (plan.prior === null) {
					await rm(plan.target, { force: true });
				} else {
					rollbackTemporary = `${plan.target}.omcs-tmp-rollback-${process.pid}-${temporaryCounter += 1}`;
					await stageFile(rollbackTemporary, plan.prior);
					await renameFile(rollbackTemporary, plan.target);
				}
				await syncDirectory(dirname(plan.target));
			} catch (rollbackError) {
				if (rollbackTemporary) await rm(rollbackTemporary, { force: true }).catch(() => undefined);
				rollbackErrors.push(rollbackError);
			}
		}
		await removeCreatedDirectories(createdDirectories).catch((cleanupError: unknown) => rollbackErrors.push(cleanupError));
		if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "skill sync failed and rollback was incomplete");
		throw error;
	}
}

function parseFrontmatter(markdown: string, path: string): { name: string; description: string } {
	const match = /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n/.exec(markdown);
	if (!match) fail(`${path} must begin with name and one-line description frontmatter`);
	return { name: match[1] ?? "", description: match[2] ?? "" };
}

function noticeEntry(notices: string, skill: SkillDefinition): string {
	const marker = `### ${skill.name}`;
	const start = notices.indexOf(marker);
	if (start === -1) fail(`${skill.name} has no skill-level provenance entry`);
	const end = notices.indexOf("\n### ", start + marker.length);
	return notices.slice(start, end === -1 ? undefined : end);
}

function exactNoticeSection(notices: string, expectation: NoticeExpectation): string {
	const marker = `### ${expectation.heading}\n`;
	const start = notices.indexOf(marker);
	if (start === -1) fail(`${expectation.heading} section is missing`);
	if (notices.indexOf(marker, start + marker.length) !== -1) fail(`${expectation.heading} section is duplicated`);
	const end = notices.indexOf("\n### ", start + marker.length);
	return notices.slice(start, end === -1 ? undefined : end);
}

function validateNoticeExpectation(notices: string, expectation: NoticeExpectation): void {
	const lines = new Set(exactNoticeSection(notices, expectation).split("\n"));
	for (const field of expectation.fields) {
		if (!lines.has(field.line)) fail(`${expectation.heading} ${field.name} is missing or incorrect`);
	}
	const bulletLines = [...lines].filter((line) => line.startsWith("- "));
	if (bulletLines.length !== expectation.fields.length) fail(`${expectation.heading} contains duplicated or unexpected metadata fields`);
}

export async function verifySkills(options: VerifySkillsOptions = {}): Promise<void> {
	const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
	const sourceRoot = join(repositoryRoot, "skills");
	const pluginRoot = join(repositoryRoot, "plugins", "oh-my-codex-slim", "skills");
	await inspectPath(repositoryRoot, sourceRoot, "directory", false);
	await inspectPath(repositoryRoot, pluginRoot, "directory", false);
	const names = SKILL_CATALOG.map((skill) => skill.name);
	if (new Set(names).size !== names.length) fail("skill catalog contains duplicate names");
	const desired = await collectDesiredTree(sourceRoot);
	const current = await inspectPluginTree(pluginRoot, desired);
	const manifest = await readManifest(pluginRoot);
	const expectedManifest = manifestBytes(desired);
	if (!manifest.bytes?.equals(expectedManifest)) fail("plugin skill ownership manifest is missing or stale");
	for (const [relativePath, bytes] of desired.files) {
		if (!current.get(relativePath)?.equals(bytes)) fail(`${relativePath} differs between source and plugin discovery copies`);
	}

	const notices = await readFile(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	for (const skill of SKILL_CATALOG) {
		const canonicalPath = join(sourceRoot, skill.name, "SKILL.md");
		const canonical = (desired.files.get(join(skill.name, "SKILL.md")) ?? fail(`${skill.name} is missing`)).toString("utf8");
		const frontmatter = parseFrontmatter(canonical, canonicalPath);
		if (frontmatter.name !== skill.name) fail(`${skill.name} frontmatter name is ${frontmatter.name}`);
		if (frontmatter.description !== skill.description) fail(`${skill.name} description differs from the catalog`);
		const normalized = canonical.toLowerCase();
		if (/\bopencode\b/i.test(canonical) || forbiddenTerms.some((term) => normalized.includes(term))) fail(`${skill.name} contains prohibited runtime vocabulary`);
		const [repository, path, revision, author, owner, status] = primaryNoticeExpectations[skill.name] ?? fail(`${skill.name} has no provenance expectation`);
		const expected = [
			`- Source repository: <https://github.com/${repository}>`,
			`- Source path: \`${path}\``,
			`- Pinned revision: \`${revision}\``,
			"- License: MIT",
			`- Status: ${status}`,
			`- Upstream author/copyright holder: ${author}`,
			`- Repository owner: \`${owner}\``,
		];
		const lines = new Set(noticeEntry(notices, skill).split("\n"));
		for (const line of expected) if (!lines.has(line)) fail(`${skill.name} provenance is missing or incorrect: ${line}`);
	}
	for (const expectation of supportingNoticeExpectations) validateNoticeExpectation(notices, expectation);
	process.stdout.write(`Verified ${SKILL_CATALOG.length} attributed skills and identical plugin discovery resources.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const operation = process.argv.includes("--sync") ? syncDiscoveryCopies().then(() => verifySkills()) : verifySkills();
	operation.catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
