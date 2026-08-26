#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxScanBytes = 1_000_000;
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

interface Pattern {
	rule: string;
	pattern: RegExp;
	value: (match: RegExpExecArray) => string;
}

const patterns: readonly Pattern[] = [
	{ rule: "authorization-header", pattern: /\bauthorization\s*:\s*(?:bearer|basic|token)\s+([A-Za-z0-9._~+/-]{8,})/gi, value: (match) => match[1] ?? "" },
	{ rule: "cookie-value", pattern: /\b(?:set-)?cookie\s*:\s*[^=\s;]+=\"?([A-Za-z0-9._~+/-]{8,})\"?/gi, value: (match) => match[1] ?? "" },
	{ rule: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g, value: (match) => match[0] },
	{ rule: "local-home-path", pattern: /(?:^|[\s"'(=])((?:\/(?:Users|home)\/[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)*)(?=$|[\s"'(),;])/g, value: (match) => match[1] ?? "" },
	{ rule: "openai-token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/g, value: (match) => match[0] },
	{ rule: "pem-private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{16,}\r?\n)+-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi, value: (match) => match[0] },
	{ rule: "provider-token", pattern: /\b(?:xai|sk-ant|AIza)[-_]?[A-Za-z0-9_-]{20,255}\b/g, value: (match) => match[0] },
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
	return /^(?:redacted|example|placeholder)(?:[-_][a-z0-9._-]+)?$/.test(normalized)
		|| /(?:^|[-_])synthetic(?:[-_]|$)/.test(normalized);
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

/** Scans only canonical Git-tracked, bounded regular files and never returns matched content. */
export async function scanPublicFiles(root = process.cwd(), options: ScanPublicFilesOptions = {}): Promise<PublicSecretFinding[]> {
	const environment = sanitizedGitEnvironment(options.environment ?? process.env);
	const repositoryRoot = resolveCanonicalRepository(root, environment);
	const findings: PublicSecretFinding[] = [];
	for (const path of trackedFiles(repositoryRoot, environment)) {
		const content = printableStrings(await readTrackedFile(repositoryRoot, path, options.beforeOpen));
		if (privateStatePath.test(path)) {
			findings.push({ path, rule: "private-run-state" });
			continue;
		}
		if (dotenvBasename(path)) {
			findings.push({ path, rule: "dotenv-file" });
			continue;
		}
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
	}
	return findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
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
