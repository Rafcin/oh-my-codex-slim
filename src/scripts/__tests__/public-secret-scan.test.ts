import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scanPublicFiles } from "../public-secret-scan.js";

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "omcs-public-secret-scan-"));
	execFileSync("git", ["init", "--quiet"], { cwd: root });
	return root;
}

function stage(root: string): void {
	execFileSync("git", ["add", "--all"], { cwd: root });
}

describe("public secret scan", () => {
	it("reports only path and rule for tracked credential, cookie, SSH, and local-path fixtures", async () => {
		const root = await fixture();
		try {
			const letters = "a".repeat(64);
			await writeFile(join(root, "key.pem"), ["-----BEGIN ", "PRIVATE KEY-----", letters].join(""));
			await writeFile(join(root, "tokens.txt"), ["ghp_", "b".repeat(36), "\n", "sk-proj-", "c".repeat(48), "\n", "xai-", "d".repeat(48)].join(""));
			await writeFile(join(root, "github-pat.txt"), ["github", "_pat_", "e".repeat(40)].join(""));
			await writeFile(join(root, "headers.txt"), ["Authorization: Bearer ", letters, "\nCookie: session=", letters].join(""));
			await writeFile(join(root, "id.pub"), ["ssh-", "ed25519 ", letters].join(""));
			await writeFile(join(root, "local-path.txt"), ["/Users/", "fixture-user/project"].join(""));
			await writeFile(join(root, ".env.local"), "CONFIG_NAME=fixture\n");
			stage(root);

			const findings = await scanPublicFiles(root);
			assert.deepEqual(findings, [
				{ path: ".env.local", rule: "dotenv-file" },
				{ path: "github-pat.txt", rule: "github-token" },
				{ path: "headers.txt", rule: "authorization-header" },
				{ path: "headers.txt", rule: "cookie-value" },
				{ path: "id.pub", rule: "ssh-public-material" },
				{ path: "key.pem", rule: "pem-private-key" },
				{ path: "local-path.txt", rule: "local-home-path" },
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
});
