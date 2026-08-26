#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";

const maxScanBytes = 1_000_000;
const maxArtifactBytes = 64 * 1024 * 1024;
const maxArtifactEntries = 1_000;
const maxArtifactContentBytes = 64 * 1024 * 1024;
const privateStatePath = /^(?:\.superpowers\/sdd\/|\.omcs\/|\.gjc\/)/;

export interface PublicSecretFinding {
	path: string;
	rule: string;
}

export interface ScanPublicFilesOptions {
	environment?: NodeJS.ProcessEnv;
	/** Test-only deterministic seam for proving the descriptor identity check. */
	beforeOpen?: (trackedPath: string) => Promise<void>;
}

export interface NpmPackageArtifactScan {
	sha256: string;
	paths: string[];
	findings: PublicSecretFinding[];
}

interface Pattern {
	rule: string;
	pattern: RegExp;
	value: (match: RegExpExecArray) => string;
}

const patterns: readonly Pattern[] = [
	{ rule: "authorization-header", pattern: /\bauthorization\s*:\s*(?:bearer|basic|token)\s+([A-Za-z0-9._~+/-]{8,})/gi, value: (match) => match[1] ?? "" },
	{ rule: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, value: (match) => match[0] },
	{ rule: "aws-secret-access-key", pattern: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?([A-Za-z0-9+/]{40})["']?/g, value: (match) => match[1] ?? "" },
	{ rule: "cookie-value", pattern: /\b(?:set-)?cookie\s*:\s*[^=\s;]+=\"?([A-Za-z0-9._~+/-]{8,})\"?/gi, value: (match) => match[1] ?? "" },
	{ rule: "credentialed-url", pattern: /\b(?:https?|git|ssh):\/\/[^\s:/@]+:([^\s/@?#]{8,})@[^\s/@]+/gi, value: (match) => match[1] ?? "" },
	{ rule: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g, value: (match) => match[0] },
	{ rule: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g, value: (match) => match[0] },
	{ rule: "local-home-path", pattern: /(?:^|[\s"'(=])((?:\/(?:Users|home)\/[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)*)(?=$|[\s"'(),;])/g, value: (match) => match[1] ?? "" },
	{ rule: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, value: (match) => match[0] },
	{ rule: "openai-token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/g, value: (match) => match[0] },
	{ rule: "pem-private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{16,}\r?\n)+-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi, value: (match) => match[0] },
	{ rule: "provider-token", pattern: /\b(?:xai|sk-ant|AIza)[-_]?[A-Za-z0-9_-]{20,255}\b/g, value: (match) => match[0] },
	{ rule: "secret-assignment", pattern: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{16,255})/gi, value: (match) => match[1] ?? "" },
	{ rule: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g, value: (match) => match[0] },
	{ rule: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,255}\b/g, value: (match) => match[0] },
];

function sanitizedGitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(source)) if (!key.startsWith("GIT_")) environment[key] = value;
	return { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "0", GIT_OPTIONAL_LOCKS: "0" };
}

function resolveCanonicalRepository(root: string, source: NodeJS.ProcessEnv): string {
	const start = realpathSync(root);
	const environment = sanitizedGitEnvironment(source);
	const reportedRoot = execFileSync("git", ["-C", start, "rev-parse", "--show-toplevel"], { encoding: "utf8", env: environment }).trim();
	const repositoryRoot = realpathSync(reportedRoot);
	const fromRepository = relative(repositoryRoot, start);
	if (fromRepository === ".." || fromRepository.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
		throw new Error("public-secret-scan: Git root does not contain the requested directory");
	}
	return repositoryRoot;
}

/** Resolves a caller to its canonical Git root without honoring ambient Git overrides. */
export function resolvePublicRepositoryRoot(root = process.cwd(), environment: NodeJS.ProcessEnv = process.env): string {
	return resolveCanonicalRepository(root, sanitizedGitEnvironment(environment));
}

function trackedFiles(root: string, environment: NodeJS.ProcessEnv): string[] {
	const output = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "buffer", env: environment, maxBuffer: 16 * 1024 * 1024 });
	return output.toString("utf8").split("\0").filter(Boolean).sort();
}

function containedPath(root: string, trackedPath: string): string {
	if (trackedPath.includes("\0")) throw new Error("public-secret-scan: git returned an unsafe path");
	const candidate = resolve(root, trackedPath);
	const fromRoot = relative(root, candidate);
	if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
		throw new Error(`public-secret-scan: git returned a path outside the repository: ${trackedPath}`);
	}
	return candidate;
}

function printableStrings(bytes: Buffer): string {
	return bytes.toString("latin1").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

function documentedPlaceholder(value: string): boolean {
	const normalized = value.toLowerCase();
	const withoutKnownPrefix = normalized.replace(/^(?:sk-(?:proj-)?|sk-ant[-_]?|xai[-_]?|aiza[-_]?|xox[baprs]-|glpat-|gh[pousr]_|github_pat_|npm_|(?:sk|rk)_live_)/, "");
	return [normalized, withoutKnownPrefix].some((candidate) =>
		/^(?:redacted|example|placeholder)(?:[-_][a-z0-9._-]+)?$/.test(candidate)
		|| /^synthetic(?:[-_][a-z0-9._-]+)+$/.test(candidate));
}

function documentedSyntheticLocalPath(value: string): boolean {
	return value.startsWith("/Users/example/");
}

function assertRegularBoundedFile(stat: { isFile(): boolean; size: number; dev: number; ino: number; nlink: number }, trackedPath: string): void {
	if (!stat.isFile()) throw new Error(`public-secret-scan: refuses tracked non-regular file: ${trackedPath}`);
	if (stat.size > maxScanBytes) throw new Error(`public-secret-scan: refuses oversized tracked file: ${trackedPath}`);
}

function assertStableIdentity(before: { isFile(): boolean; size: number; dev: number; ino: number; nlink: number }, after: { isFile(): boolean; size: number; dev: number; ino: number; nlink: number }, trackedPath: string): void {
	if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink || before.size !== after.size) {
		throw new Error(`public-secret-scan: tracked file changed while scanning: ${trackedPath}`);
	}
}

async function readBoundedBytes(file: Awaited<ReturnType<typeof open>>, expectedSize: number, trackedPath: string): Promise<Buffer> {
	const bytes = Buffer.allocUnsafe(expectedSize + 1);
	let offset = 0;
	while (offset < bytes.length) {
		const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	if (offset > expectedSize) throw new Error(`public-secret-scan: refuses oversized tracked file: ${trackedPath}`);
	return bytes.subarray(0, offset);
}

async function readTrackedFile(root: string, trackedPath: string, beforeOpen?: (trackedPath: string) => Promise<void>): Promise<Buffer> {
	const path = containedPath(root, trackedPath);
	const before = await lstat(path);
	if (before.isSymbolicLink()) throw new Error(`public-secret-scan: refuses tracked symbolic link: ${trackedPath}`);
	assertRegularBoundedFile(before, trackedPath);
	await beforeOpen?.(trackedPath);
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await file.stat();
		assertRegularBoundedFile(opened, trackedPath);
		assertStableIdentity(before, opened, trackedPath);
		const bytes = await readBoundedBytes(file, before.size, trackedPath);
		const afterRead = await file.stat();
		const afterPath = await lstat(path);
		assertStableIdentity(before, afterRead, trackedPath);
		assertStableIdentity(before, afterPath, trackedPath);
		return bytes;
	} finally {
		await file.close();
	}
}

function dotenvBasename(path: string): boolean {
	return path.slice(path.lastIndexOf("/") + 1).startsWith(".env");
}

/** Scans one public entry's exact bytes and never returns matched content. */
export function scanPublicBytes(path: string, bytes: Buffer): PublicSecretFinding[] {
	if (bytes.byteLength > maxScanBytes) throw new Error(`public-secret-scan: refuses oversized public entry: ${path}`);
	const findings: PublicSecretFinding[] = [];
	const content = printableStrings(bytes);
	if (privateStatePath.test(path)) return [{ path, rule: "private-run-state" }];
	if (dotenvBasename(path)) return [{ path, rule: "dotenv-file" }];
	for (const { rule, pattern, value } of patterns) {
		const matcher = new RegExp(pattern.source, pattern.flags);
		let found = false;
		for (const match of content.matchAll(matcher)) {
			const matchedValue = value(match);
			const safe = rule === "local-home-path" ? documentedSyntheticLocalPath(matchedValue) : documentedPlaceholder(matchedValue);
			if (!safe) found = true;
		}
		if (found) findings.push({ path, rule });
	}
	return findings.sort((left, right) => left.rule.localeCompare(right.rule));
}

/** Scans only canonical Git-tracked, bounded regular files and never returns matched content. */
export async function scanPublicFiles(root = process.cwd(), options: ScanPublicFilesOptions = {}): Promise<PublicSecretFinding[]> {
	const environment = sanitizedGitEnvironment(options.environment ?? process.env);
	const repositoryRoot = resolvePublicRepositoryRoot(root, environment);
	const findings: PublicSecretFinding[] = [];
	for (const path of trackedFiles(repositoryRoot, environment)) {
		findings.push(...scanPublicBytes(path, await readTrackedFile(repositoryRoot, path, options.beforeOpen)));
	}
	return findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
}

function safeArtifactEntryPath(name: string): string {
	if (!name.startsWith("package/") || name.includes("\\") || name.includes("\0")) {
		throw new Error("public-secret-scan: npm artifact contains an unsafe entry path");
	}
	const path = name.slice("package/".length);
	if (!path || posix.isAbsolute(path) || posix.normalize(path) !== path || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
		throw new Error("public-secret-scan: npm artifact contains an unsafe entry path");
	}
	return path;
}

async function readPrivateArtifact(path: string): Promise<Buffer> {
	const namedBefore = await lstat(path);
	if (namedBefore.isSymbolicLink() || !namedBefore.isFile() || namedBefore.nlink !== 1 || (namedBefore.mode & 0o077) !== 0
		|| namedBefore.size <= 0 || namedBefore.size > maxArtifactBytes) {
		throw new Error("public-secret-scan: refuses unsafe npm artifact");
	}
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await file.stat();
		assertStableIdentity(namedBefore, opened, "npm artifact");
		const bytes = await readBoundedBytes(file, namedBefore.size, "npm artifact");
		const after = await file.stat();
		const namedAfter = await lstat(path);
		assertStableIdentity(namedBefore, after, "npm artifact");
		assertStableIdentity(namedBefore, namedAfter, "npm artifact");
		return bytes;
	} finally {
		await file.close();
	}
}

/** Hashes and scans exact regular-file entries from one private npm tarball without extracting it. */
export async function scanNpmPackageArtifact(path: string): Promise<NpmPackageArtifactScan> {
	const bytes = await readPrivateArtifact(resolve(path));
	const paths: string[] = [];
	const findings: PublicSecretFinding[] = [];
	const seen = new Set<string>();
	let totalContentBytes = 0;
	const extractor = tar.extract();
	let entryFailure: unknown;
	extractor.on("entry", (header, stream, next) => {
		void (async () => {
			const publicPath = safeArtifactEntryPath(header.name);
			const declaredSize = header.size;
			if (header.type !== "file") throw new Error(`public-secret-scan: refuses non-file npm artifact entry: ${publicPath}`);
			if (seen.has(publicPath)) throw new Error(`public-secret-scan: refuses duplicate npm artifact entry: ${publicPath}`);
			if (seen.size >= maxArtifactEntries || typeof declaredSize !== "number" || declaredSize < 0 || declaredSize > maxScanBytes) {
				throw new Error(`public-secret-scan: refuses oversized npm artifact entry: ${publicPath}`);
			}
			totalContentBytes += declaredSize;
			if (totalContentBytes > maxArtifactContentBytes) throw new Error("public-secret-scan: refuses oversized npm artifact content");
			const chunks: Buffer[] = [];
			let received = 0;
			for await (const chunk of stream) {
				const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				received += part.byteLength;
				if (received > declaredSize || received > maxScanBytes) throw new Error(`public-secret-scan: refuses oversized npm artifact entry: ${publicPath}`);
				chunks.push(part);
			}
			if (received !== declaredSize) throw new Error(`public-secret-scan: npm artifact entry size changed: ${publicPath}`);
			seen.add(publicPath);
			paths.push(publicPath);
			findings.push(...scanPublicBytes(publicPath, Buffer.concat(chunks, received)));
			next();
		})().catch((error: unknown) => {
			entryFailure = error;
			stream.resume();
			extractor.destroy(error instanceof Error ? error : new Error("public-secret-scan: npm artifact scan failed"));
		});
	});
	try {
		await pipeline(Readable.from([bytes]), createGunzip(), extractor);
	} catch (error) {
		throw entryFailure ?? error;
	}
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		paths: paths.sort(),
		findings: findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule)),
	};
}

function sameArtifactScan(left: NpmPackageArtifactScan, right: NpmPackageArtifactScan): boolean {
	return left.sha256 === right.sha256
		&& JSON.stringify(left.paths) === JSON.stringify(right.paths)
		&& JSON.stringify(left.findings) === JSON.stringify(right.findings);
}

/** Preserves one previously scanned private artifact with exclusive, no-clobber ownership. */
export async function preserveNpmPackageArtifact(
	sourcePath: string,
	targetPath: string,
	expected: NpmPackageArtifactScan,
): Promise<NpmPackageArtifactScan> {
	if (expected.findings.length > 0) throw new Error("public-secret-scan: refuses to preserve an unapproved npm artifact");
	const source = resolve(sourcePath);
	const target = resolve(targetPath);
	if (source === target) throw new Error("public-secret-scan: source and approved npm artifact paths must differ");
	const parent = await lstat(dirname(target));
	if (parent.isSymbolicLink() || !parent.isDirectory() || (parent.mode & 0o077) !== 0) {
		throw new Error("public-secret-scan: refuses unsafe approved artifact directory");
	}
	const bytes = await readPrivateArtifact(source);
	if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
		throw new Error("public-secret-scan: npm artifact changed after approval");
	}

	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await scanNpmPackageArtifact(target);
		if (sameArtifactScan(existing, expected)) return existing;
		throw new Error("public-secret-scan: refuses to replace an approved npm artifact");
	}
	try {
		await file.chmod(0o600);
		await file.writeFile(bytes);
		await file.sync();
		const written = await file.stat();
		if (!written.isFile() || written.nlink !== 1 || (written.mode & 0o077) !== 0 || written.size !== bytes.byteLength) {
			throw new Error("public-secret-scan: approved npm artifact write was not private and exact");
		}
	} finally {
		await file.close();
	}
	const preserved = await scanNpmPackageArtifact(target);
	if (!sameArtifactScan(preserved, expected)) throw new Error("public-secret-scan: approved npm artifact changed while preserving");
	return preserved;
}

async function main(): Promise<void> {
	const findings = await scanPublicFiles();
	if (findings.length === 0) {
		process.stdout.write("public-secret-scan: no tracked public-secret findings\n");
		return;
	}
	for (const finding of findings) process.stderr.write(`public-secret-scan: ${finding.path} [${finding.rule}]\n`);
	process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
