#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxScanBytes = 1_000_000;
const privateStatePath = /^(?:\.superpowers\/sdd\/|\.omcs\/|\.gjc\/)/;

export interface PublicSecretFinding {
	path: string;
	rule: string;
}

interface Pattern {
	rule: string;
	pattern: RegExp;
}

const patterns: readonly Pattern[] = [
	{ rule: "authorization-header", pattern: /\bauthorization\s*:\s*(?:bearer|basic|token)\s+(?!\[?(?:redacted|example|placeholder)\]?)[A-Za-z0-9._~+/-]{8,}/i },
	{ rule: "cookie-value", pattern: /\b(?:set-)?cookie\s*:\s*[^=\s;]+=(?!\[?(?:redacted|example|placeholder)\]?)[A-Za-z0-9._~+/-]{8,}/i },
	{ rule: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/ },
	{ rule: "local-home-path", pattern: /(?:^|[\s"'(=])\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/|$)/ },
	{ rule: "openai-token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/ },
	{ rule: "pem-private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i },
	{ rule: "provider-token", pattern: /\b(?:xai|sk-ant|AIza)[-_]?[A-Za-z0-9_-]{20,255}\b/ },
	{ rule: "ssh-public-material", pattern: /\bssh-(?:rsa|ed25519|ecdsa)\s+[A-Za-z0-9+/]{40,}={0,3}\b/i },
];

function trackedFiles(root: string): string[] {
	const output = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
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

function syntheticFixtureMatch(content: string, matchIndex: number, matched: string, rule: string): boolean {
	if (rule === "local-home-path") return /\/(?:Users|home)\/(?:example|me|\.\.\.|rafs)(?:\/|$)/.test(matched);
	const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
	const lineEnd = content.indexOf("\n", matchIndex);
	const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
	if (/(?:\[?(?:redacted|example|placeholder)\]?|synthetic)/i.test(line)) return true;
	if (rule === "pem-private-key") {
		const nextLine = content.slice(lineEnd < 0 ? content.length : lineEnd + 1).split("\n", 1)[0] ?? "";
		return /synthetic/i.test(nextLine);
	}
	return false;
}

function assertRegularBoundedFile(stat: { isFile(): boolean; size: number }, trackedPath: string): void {
	if (!stat.isFile()) throw new Error(`public-secret-scan: refuses tracked non-regular file: ${trackedPath}`);
	if (stat.size > maxScanBytes) throw new Error(`public-secret-scan: refuses oversized tracked file: ${trackedPath}`);
}

async function openTrackedFile(root: string, trackedPath: string) {
	const path = containedPath(root, trackedPath);
	const link = await lstat(path);
	if (link.isSymbolicLink()) throw new Error(`public-secret-scan: refuses tracked symbolic link: ${trackedPath}`);
	assertRegularBoundedFile(link, trackedPath);
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		assertRegularBoundedFile(await file.stat(), trackedPath);
		return file;
	} catch (error) {
		await file.close();
		throw error;
	}
}

async function readTrackedFile(root: string, trackedPath: string): Promise<Buffer> {
	const file = await openTrackedFile(root, trackedPath);
	try {
		return await file.readFile();
	} finally {
		await file.close();
	}
}

/** Scans only Git-tracked, bounded regular files and never returns matched content. */
export async function scanPublicFiles(root = process.cwd()): Promise<PublicSecretFinding[]> {
	const findings: PublicSecretFinding[] = [];
	for (const path of trackedFiles(root)) {
		const file = await openTrackedFile(root, path);
		await file.close();
		if (privateStatePath.test(path)) {
			findings.push({ path, rule: "private-run-state" });
			continue;
		}
		if (/(?:^|\/)\.env(?:\.|$)/i.test(path)) {
			findings.push({ path, rule: "dotenv-file" });
			continue;
		}
		const content = printableStrings(await readTrackedFile(root, path));
		for (const { rule, pattern } of patterns) {
			const match = pattern.exec(content);
			if (match && !syntheticFixtureMatch(content, match.index, match[0], rule)) findings.push({ path, rule });
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
