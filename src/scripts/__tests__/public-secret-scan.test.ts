import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import * as tar from "tar-stream";
import * as publicSecretScanner from "../public-secret-scan.js";

const { scanPublicFiles } = publicSecretScanner;

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "omcs-public-secret-scan-"));
	execFileSync("git", ["init", "--quiet"], { cwd: root });
	return root;
}

function stage(root: string): void {
	execFileSync("git", ["add", "--all"], { cwd: root });
}

async function packageTarball(entries: readonly { path: string; bytes: Buffer; type?: "file" | "symlink" }[]): Promise<Buffer> {
	const pack = tar.pack();
	const chunks: Buffer[] = [];
	pack.on("data", (chunk: Buffer) => chunks.push(chunk));
	const completed = new Promise<void>((resolve, reject) => {
		pack.on("end", resolve);
		pack.on("error", reject);
	});
	for (const entry of entries) {
		if (entry.type === "symlink") pack.entry({ name: `package/${entry.path}`, type: "symlink", linkname: "package/safe.txt" });
		else pack.entry({ name: `package/${entry.path}`, size: entry.bytes.byteLength }, entry.bytes);
	}
	pack.finalize();
	await completed;
	return gzipSync(Buffer.concat(chunks));
}

describe("public secret scan", () => {
	it("reports only path and rule for tracked credential, cookie, SSH, and local-path fixtures", async () => {
		const root = await fixture();
		try {
			const letters = "a".repeat(64);
			await writeFile(join(root, "key.pem"), ["-----BEGIN ", "PRIVATE KEY-----\n", letters, "\n-----END ", "PRIVATE KEY-----"].join(""));
			await writeFile(join(root, "tokens.txt"), ["ghp_", "b".repeat(36), "\n", "sk-proj-", "c".repeat(48), "\n", "xai-", "d".repeat(48)].join(""));
			await writeFile(join(root, "github-pat.txt"), ["github", "_pat_", "e".repeat(40)].join(""));
			await writeFile(join(root, "headers.txt"), ["Authorization: Bearer ", letters, "\nCookie: session=\"", letters, "\""].join(""));
			await writeFile(join(root, "openssh.key"), ["-----BEGIN OPENSSH ", "PRIVATE KEY-----\n", letters, "\n-----END OPENSSH ", "PRIVATE KEY-----"].join(""));
			await writeFile(join(root, "local-path.txt"), ["/Users/", "fixture-user/project"].join(""));
			await writeFile(join(root, ".env.local"), "CONFIG_NAME=fixture\n");
			await writeFile(join(root, ".envrc"), "CONFIG_NAME=fixture\n");
			stage(root);

			const findings = await scanPublicFiles(root);
			assert.deepEqual(findings, [
				{ path: ".env.local", rule: "dotenv-file" },
				{ path: ".envrc", rule: "dotenv-file" },
				{ path: "github-pat.txt", rule: "github-token" },
				{ path: "headers.txt", rule: "authorization-header" },
				{ path: "headers.txt", rule: "cookie-value" },
				{ path: "key.pem", rule: "pem-private-key" },
				{ path: "local-path.txt", rule: "local-home-path" },
				{ path: "openssh.key", rule: "pem-private-key" },
				{ path: "tokens.txt", rule: "github-token" },
				{ path: "tokens.txt", rule: "openai-token" },
				{ path: "tokens.txt", rule: "provider-token" },
			]);
			assert.doesNotMatch(JSON.stringify(findings), /ghp_|sk-proj-|fixture-user|Bearer/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("permits documented names, redactions, checksums, public revisions, and synthetic placeholders", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "safe.txt"), [
				"OPENAI_API_KEY", "PROVIDER_TOKEN", "Authorization: Bearer [REDACTED]", "Cookie: session=[REDACTED]",
				`sha256:${"e".repeat(64)}`, "37b75cad535abdd46531f0227483a8842d045ab8", "example-token-placeholder",
				["sk-proj-", "synthetic-placeholder-value".repeat(2)].join(""), ["-----BEGIN ", "PRIVATE KEY-----", "\nsynthetic fixture"].join(""),
			].join("\n"));
			stage(root);
			assert.deepEqual(await scanPublicFiles(root), []);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not let a same-line placeholder or safe word hide a later real token", async () => {
		const root = await fixture();
		try {
			const real = ["sk-proj-", "q".repeat(48)].join("");
			const placeholder = ["sk-proj-", "synthetic-placeholder-value".repeat(2)].join("");
			await writeFile(join(root, "mixed.txt"), [placeholder, real, "example", real].join(" "));
			stage(root);
			assert.deepEqual(await scanPublicFiles(root), [{ path: "mixed.txt", rule: "openai-token" }]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports common production credential families without returning matched values", async () => {
		const root = await fixture();
		try {
			const values = [
				["AK", "IA", "A".repeat(16)].join(""),
				["npm", "_", "B".repeat(36)].join(""),
				["xox", "b-", "1".repeat(12), "-", "2".repeat(12), "-", "C".repeat(24)].join(""),
				["gl", "pat-", "D".repeat(24)].join(""),
				["sk", "_live_", "E".repeat(24)].join(""),
				["https://release-user:", "F".repeat(24), "@packages.example.invalid/archive"].join(""),
				["client_", "secret = \"", "G".repeat(32), "\""].join(""),
			].join("\n");
			await writeFile(join(root, "credentials.txt"), values);
			stage(root);

			const findings = await scanPublicFiles(root);
			assert.deepEqual(findings, [
				{ path: "credentials.txt", rule: "aws-access-key" },
				{ path: "credentials.txt", rule: "credentialed-url" },
				{ path: "credentials.txt", rule: "gitlab-token" },
				{ path: "credentials.txt", rule: "npm-token" },
				{ path: "credentials.txt", rule: "secret-assignment" },
				{ path: "credentials.txt", rule: "slack-token" },
				{ path: "credentials.txt", rule: "stripe-live-key" },
			]);
			assert.doesNotMatch(JSON.stringify(findings), /AKIA|release-user|AAAA|BBBB|CCCC|DDDD|EEEE|FFFF|GGGG/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("permits synthetic assignment and credentialed URL placeholders", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "synthetic.md"), [
				["client_", "secret=synthetic-secret-never-use"].join(""),
				["https://fixture-user:", "synthetic-placeholder", "@example.invalid/api"].join(""),
				["xox", "b-synthetic-placeholder-token"].join(""),
			].join("\n"));
			stage(root);
			assert.deepEqual(await scanPublicFiles(root), []);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not let an embedded synthetic word exempt a production-shaped secret", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "synthetic-bypass.txt"), [
				["pass", "word=actual-synthetic-production-secret"].join(""),
				["https://fixture-user:actual-synthetic-password", "@example.invalid/api"].join(""),
			].join("\n"));
			stage(root);
			assert.deepEqual(await scanPublicFiles(root), [
				{ path: "synthetic-bypass.txt", rule: "credentialed-url" },
				{ path: "synthetic-bypass.txt", rule: "secret-assignment" },
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("detects AWS secret access keys and Stripe live restricted keys", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "additional-credentials.txt"), [
				["AWS_SECRET_ACCESS_", "KEY=", "H".repeat(40)].join(""),
				["rk", "_live_", "J".repeat(24)].join(""),
			].join("\n"));
			stage(root);
			assert.deepEqual(await scanPublicFiles(root), [
				{ path: "additional-credentials.txt", rule: "aws-secret-access-key" },
				{ path: "additional-credentials.txt", rule: "stripe-live-key" },
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports approved-only and bare local home paths without exposing either username", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "home-a.txt"), ["/Users/", "rafs/.codex"].join(""));
			await writeFile(join(root, "home-b.txt"), ["/Users/", "alice"].join(""));
			await writeFile(join(root, "home-c.txt"), ["/", "home/", "alice/project"].join(""));
			await writeFile(join(root, "home-d.txt"), ["/", "home/", "alice"].join(""));
			stage(root);
			const findings = await scanPublicFiles(root);
			assert.deepEqual(findings, [
				{ path: "home-a.txt", rule: "local-home-path" },
				{ path: "home-b.txt", rule: "local-home-path" },
				{ path: "home-c.txt", rule: "local-home-path" },
				{ path: "home-d.txt", rule: "local-home-path" },
			]);
			assert.doesNotMatch(JSON.stringify(findings), /rafs|alice/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses the canonical Git index even when the caller supplies an empty alternate index", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "detected.txt"), ["xai-", "r".repeat(48)].join(""));
			stage(root);
			const alternateIndex = join(root, "alternate.index");
			execFileSync("git", ["read-tree", "--empty"], { cwd: root, env: { ...process.env, GIT_INDEX_FILE: alternateIndex } });
			assert.deepEqual(await scanPublicFiles(root, { environment: {
				...process.env,
				GIT_INDEX_FILE: alternateIndex,
				GIT_DIR: join(root, "untrusted-git-dir"),
				GIT_WORK_TREE: join(root, "untrusted-work-tree"),
				GIT_OBJECT_DIRECTORY: join(root, "untrusted-objects"),
				GIT_NAMESPACE: "untrusted-namespace",
			} }), [
				{ path: "detected.txt", rule: "provider-token" },
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a tracked file replaced between identity proof and descriptor open", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "stable.txt"), "initial\n");
			stage(root);
			await assert.rejects(
				() => scanPublicFiles(root, {
					beforeOpen: async (path) => {
						if (path === "stable.txt") {
							const replacement = join(root, "replacement.txt");
							await writeFile(replacement, "replacement that changes the verified size\n");
							await rename(replacement, join(root, path));
						}
					},
				}),
				/tracked file changed while scanning: stable\.txt/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses a tracked symbolic link without following it", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "target.txt"), "safe\n");
			await symlink("target.txt", join(root, "linked.txt"));
			stage(root);
			assert.equal((await lstat(join(root, "linked.txt"))).isSymbolicLink(), true);
			await assert.rejects(() => scanPublicFiles(root), /refuses tracked symbolic link: linked\.txt/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses a tracked dotenv symbolic link before reporting the path rule", async () => {
		const root = await fixture();
		try {
			await writeFile(join(root, "target.txt"), "safe\n");
			await symlink("target.txt", join(root, ".env.local"));
			stage(root);
			await assert.rejects(() => scanPublicFiles(root), /refuses tracked symbolic link: \.env\.local/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("scans the exact regular-file entries and hashes the exact npm tarball bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-package-secret-scan-"));
		try {
			const tarball = await packageTarball([
				{ path: "README.md", bytes: Buffer.from("safe\n") },
				{ path: "dist/generated.js", bytes: Buffer.from(["export const key = \"", "AK", "IA", "H".repeat(16), "\";\n"].join("")) },
			]);
			const tarballPath = join(root, "oh-my-codex-slim-0.1.0.tgz");
			await writeFile(tarballPath, tarball, { mode: 0o600 });
			const scan = (publicSecretScanner as { scanNpmPackageArtifact?: (path: string) => Promise<unknown> }).scanNpmPackageArtifact;
			assert.equal(typeof scan, "function");
			const result = await scan!(tarballPath) as { sha256: string; paths: string[]; findings: unknown[] };
			assert.deepEqual(result, {
				sha256: createHash("sha256").update(tarball).digest("hex"),
				paths: ["README.md", "dist/generated.js"],
				findings: [{ path: "dist/generated.js", rule: "aws-access-key" }],
			});
			assert.deepEqual(await readdir(root), ["oh-my-codex-slim-0.1.0.tgz"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves the exact approved npm artifact privately and never replaces different bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-approved-package-"));
		try {
			const approvedDirectory = join(root, "release");
			await mkdir(approvedDirectory, { mode: 0o700 });
			const source = join(root, "candidate.tgz");
			const target = join(approvedDirectory, "approved.tgz");
			const approvedBytes = await packageTarball([{ path: "README.md", bytes: Buffer.from("approved\n") }]);
			await writeFile(source, approvedBytes, { mode: 0o600 });
			const expected = await publicSecretScanner.scanNpmPackageArtifact(source);
			assert.deepEqual(await publicSecretScanner.preserveNpmPackageArtifact(source, target, expected), expected);
			assert.deepEqual(await publicSecretScanner.preserveNpmPackageArtifact(source, target, expected), expected, "same bytes are idempotent");
			assert.equal((await lstat(target)).mode & 0o777, 0o600);
			assert.deepEqual(await readFile(target), approvedBytes);

			const differentSource = join(root, "different.tgz");
			const differentBytes = await packageTarball([{ path: "README.md", bytes: Buffer.from("different\n") }]);
			await writeFile(differentSource, differentBytes, { mode: 0o600 });
			const different = await publicSecretScanner.scanNpmPackageArtifact(differentSource);
			await assert.rejects(() => publicSecretScanner.preserveNpmPackageArtifact(differentSource, target, different), /refuses to replace an approved npm artifact/);
			assert.deepEqual(await readFile(target), approvedBytes);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not expose a partial final artifact when an approved-stage write fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-approved-package-failure-"));
		try {
			const approvedDirectory = join(root, "release");
			await mkdir(approvedDirectory, { mode: 0o700 });
			const source = join(root, "candidate.tgz");
			const target = join(approvedDirectory, "approved.tgz");
			await writeFile(source, await packageTarball([{ path: "README.md", bytes: Buffer.from("approved\n") }]), { mode: 0o600 });
			const expected = await publicSecretScanner.scanNpmPackageArtifact(source);
			await assert.rejects(() => publicSecretScanner.preserveNpmPackageArtifact(source, target, expected, {
				writeStage: async (file, bytes) => {
					await file.write(bytes.subarray(0, Math.floor(bytes.byteLength / 2)));
					throw new Error("injected approved-stage write failure");
				},
			}), /injected approved-stage write failure/);
			await assert.rejects(lstat(target), /ENOENT/);
			assert.deepEqual(await readdir(approvedDirectory), []);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("recovers an exact orphaned owned stage link after interrupted no-clobber install", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-approved-package-recovery-"));
		try {
			const approvedDirectory = join(root, "release");
			await mkdir(approvedDirectory, { mode: 0o700 });
			const source = join(root, "candidate.tgz");
			const target = join(approvedDirectory, "approved.tgz");
			const orphanedStage = join(approvedDirectory, ".approved.tgz.12345678-1234-4abc-8def-1234567890ab.stage");
			const approvedBytes = await packageTarball([{ path: "README.md", bytes: Buffer.from("approved\n") }]);
			await writeFile(source, approvedBytes, { mode: 0o600 });
			await writeFile(orphanedStage, approvedBytes, { mode: 0o600 });
			await link(orphanedStage, target);
			assert.equal((await lstat(target)).nlink, 2);

			const expected = await publicSecretScanner.scanNpmPackageArtifact(source);
			assert.deepEqual(await publicSecretScanner.preserveNpmPackageArtifact(source, target, expected), expected);
			assert.equal((await lstat(target)).nlink, 1);
			assert.deepEqual(await readdir(approvedDirectory), ["approved.tgz"]);
			assert.deepEqual(await readFile(target), approvedBytes);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
