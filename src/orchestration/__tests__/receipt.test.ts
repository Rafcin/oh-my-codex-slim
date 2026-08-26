import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { __setWriteRunReceiptHooksForTest, writeRunReceipt, type OrchestrationReceipt } from "../receipt.js";

const FIXED_NAME = "2026-08-26T12-34-56-789Z-123e4567-e89b-12d3-a456-426614174000.json";

async function fixture(): Promise<string> { return mkdtemp(join(tmpdir(), "omcs-receipt-")); }

function receipt(overrides: Partial<OrchestrationReceipt> = {}): OrchestrationReceipt {
	return {
		schemaVersion: 1, profile: "thorough", route: "full",
		skills: ["tdd", "verification", "code-review"],
		agents: ["omcs_architect", "omcs_terra_fixer", "omcs_reviewer"],
		approval: "material-decisions", verification: [{ command: "npm test", outcome: "passed" }], review: { verdict: "ship" }, ...overrides,
	};
}

function deterministicName(): void { __setWriteRunReceiptHooksForTest({ nextReceiptName: () => FIXED_NAME, nextUuid: () => "123e4567-e89b-12d3-a456-426614174000" }); }
function clearHooks(): void { __setWriteRunReceiptHooksForTest(); }

describe("private OMCS run receipts", () => {
	it("writes a canonical minimal receipt below a private runs directory", async () => {
		const root = await fixture();
		try {
			deterministicName();
			const path = await writeRunReceipt(root, receipt());
			assert.equal(path, join(root, ".omcs", "runs", FIXED_NAME));
			assert.equal((await lstat(path)).mode & 0o777, 0o600);
			assert.equal((await lstat(join(root, ".omcs"))).mode & 0o777, 0o700);
			assert.equal((await lstat(join(root, ".omcs", "runs"))).mode & 0o777, 0o700);
			assert.equal(await readFile(path, "utf8"), `${JSON.stringify(receipt(), null, "\t")}\n`);
		} finally { clearHooks(); await rm(root, { recursive: true, force: true }); }
	});

	it("accepts only narrow local verification command labels", async () => {
		const root = await fixture();
		try {
			for (const command of ["npm test", "node --test dist/orchestration/__tests__/receipt.test.js", "git diff --check", "omcs status", "tsc --noEmit", "biome lint src"]) {
				await writeRunReceipt(root, receipt({ verification: [{ command, outcome: "passed" }] }));
			}
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects environment-shaped arguments for every approved tool before creating .omcs", async () => {
		const root = await fixture();
		try {
			const unsafe = [
				"npm --env-file=.env test", "npm --ENV=production test", "npm dotenv test", "npm test NODE_OPTIONS=--trace-warnings",
				"node --env-file=.env --test", "node --ENV=production --test", "node process.env", "node $HOME",
				"git --env=production status", "git environment status", "git status %HOME%", "git status .env",
				"omcs --env-file=.env status", "omcs --ENV=production status", "omcs dotenv status", "omcs status KEY=value",
			];
			for (const command of unsafe) await assert.rejects(writeRunReceipt(root, receipt({ verification: [{ command, outcome: "passed" }] })), /receipt|unsafe|invalid/i, command);
			await assert.rejects(lstat(join(root, ".omcs")), { code: "ENOENT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects non-local labels, paths, providers, interpreters, secrets, and shell syntax before any write", async () => {
		const root = await fixture();
		try {
			const unsafe = [
				"curl https://example.test", "npm test /private/var/folders/x", "npm test ~/private", "npm test ../outside",
				"TOKEN=x npm test", "npm test $HOME", "npm test; cat result", "npm test | cat", "npm test && cat result",
				"node -e source", "node --eval source", "node -c source", "node --execute source", "node -", "node /dev/stdin",
				"python -c source", "ruby -e source", "perl -e source", "sh -c source", "bash -c source", "zsh -c source", "fish -c source",
				"openai endpoint", "anthropic model", "gemini model", "claude endpoint", "azure provider", "bedrock provider",
				"npm test --api-key=x", "npm test --authorization=x", "npm test --cookie=x", "npm test --password=x",
			];
			for (const command of unsafe) await assert.rejects(writeRunReceipt(root, receipt({ verification: [{ command, outcome: "passed" }] })), /receipt|unsafe|invalid/i, command);
			await assert.rejects(lstat(join(root, ".omcs")), { code: "ENOENT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects unsafe receipt fields and bounded catalog overflows before creating a directory", async () => {
		const root = await fixture();
		try {
			const unsafe = [
				{ ...receipt(), token: "not-safe" }, { ...receipt(), review: { verdict: "ship", providerCredential: "not-safe" } },
				{ ...receipt(), skills: ["tdd".repeat(80)] }, { ...receipt(), agents: ["not-a-catalog-agent"] },
				{ ...receipt(), verification: Array.from({ length: 33 }, () => ({ command: "npm test", outcome: "passed" })) },
			];
			for (const candidate of unsafe) await assert.rejects(writeRunReceipt(root, candidate as OrchestrationReceipt), /receipt|unsafe|invalid/i);
			await assert.rejects(lstat(join(root, ".omcs")), { code: "ENOENT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses symlinked, hardlinked, and non-directory receipt path entries", async () => {
		const root = await fixture();
		try {
			const outside = join(root, "outside"); await mkdir(outside); await symlink(outside, join(root, ".omcs"));
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|symlink/i);
			await rm(join(root, ".omcs")); await writeFile(join(root, ".omcs"), "not a directory");
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|directory/i);
			await rm(join(root, ".omcs")); await mkdir(join(root, ".omcs")); await writeFile(join(root, ".omcs", "runs"), "not a directory");
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|directory/i);
			await rm(join(root, ".omcs", "runs")); await writeFile(join(root, "target"), "user-owned"); await link(join(root, "target"), join(root, ".omcs", "runs"));
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|directory/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses an injected ancestor swap before publishing and leaks no receipt bytes outside", async () => {
		const root = await fixture(); const outside = await fixture();
		try {
			__setWriteRunReceiptHooksForTest({ nextReceiptName: () => FIXED_NAME, beforePathMutation: async (phase: "ensure-private-directory" | "stage-directory" | "stage-file" | "publish" | "cleanup-file" | "cleanup-directory") => {
				if (phase !== "publish") return;
				await rename(join(root, ".omcs", "runs"), join(root, ".omcs", "moved-runs")); await symlink(outside, join(root, ".omcs", "runs"));
			} });
			await assert.rejects(writeRunReceipt(root, receipt()), /changed|unsafe|directory/i);
			assert.deepEqual(await readdir(outside), []);
		} finally { clearHooks(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
	});

	it("does not overwrite a deterministic target collision and cleans only its verified private stage", async () => {
		const root = await fixture();
		try {
			const runs = join(root, ".omcs", "runs"); await mkdir(runs, { recursive: true, mode: 0o700 }); await writeFile(join(runs, FIXED_NAME), "user-owned\n", { mode: 0o600 });
			deterministicName(); await assert.rejects(writeRunReceipt(root, receipt()), { code: "EEXIST" });
			assert.equal(await readFile(join(runs, FIXED_NAME), "utf8"), "user-owned\n"); assert.deepEqual((await readdir(runs)).filter((entry) => entry.endsWith(".stage")), []);
		} finally { clearHooks(); await rm(root, { recursive: true, force: true }); }
	});

	it("preserves a bounded private recovery artifact after staged write failure", async () => {
		const root = await fixture();
		try {
			__setWriteRunReceiptHooksForTest({ beforeStageWrite: async () => { throw new Error("injected staged write failure"); } });
			await assert.rejects(writeRunReceipt(root, receipt()), /injected staged write failure/);
			const entries = await readdir(join(root, ".omcs", "runs")); assert.equal(entries.filter((entry) => entry.endsWith(".stage")).length, 1); assert.equal(entries.filter((entry) => entry.endsWith(".json")).length, 0);
		} finally { clearHooks(); await rm(root, { recursive: true, force: true }); }
	});

	it("preserves a visible receipt and private recovery artifact after post-link or cleanup failure", async () => {
		for (const phase of ["afterVisibleCommit", "beforeCleanup"] as const) {
			const root = await fixture();
			try {
				__setWriteRunReceiptHooksForTest({ nextReceiptName: () => FIXED_NAME, [phase]: async () => { throw new Error(`injected ${phase}`); } });
				const target = join(root, ".omcs", "runs", FIXED_NAME); await assert.rejects(writeRunReceipt(root, receipt()), /committed|recovery|injected/i);
				assert.equal((await lstat(target)).mode & 0o777, 0o600); assert.equal(await readFile(target, "utf8"), `${JSON.stringify(receipt(), null, "\t")}\n`);
				assert.equal((await readdir(join(root, ".omcs", "runs"))).filter((entry) => entry.endsWith(".stage")).length, 1);
			} finally { clearHooks(); await rm(root, { recursive: true, force: true }); }
		}
	});
});
