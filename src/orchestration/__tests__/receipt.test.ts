import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { writeRunReceipt, type OrchestrationReceipt } from "../receipt.js";

async function fixture(): Promise<string> {
	return mkdtemp(join(tmpdir(), "omcs-receipt-"));
}

function receipt(overrides: Partial<OrchestrationReceipt> = {}): OrchestrationReceipt {
	return {
		schemaVersion: 1,
		profile: "thorough",
		route: "full",
		skills: ["tdd", "verification", "code-review"],
		agents: ["omcs_architect", "omcs_terra_fixer", "omcs_reviewer"],
		approval: "material-decisions",
		verification: [{ command: "npm test", outcome: "passed" }],
		review: { verdict: "ship" },
		...overrides,
	};
}

describe("private OMCS run receipts", () => {
	it("writes a canonical minimal receipt below a private runs directory", async () => {
		const root = await fixture();
		try {
			const path = await writeRunReceipt(root, receipt());
			assert.match(path, new RegExp(`^${root.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}/\\.omcs/runs/\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-[0-9a-f-]{36}\\.json$`));
			assert.equal((await lstat(path)).mode & 0o777, 0o600);
			assert.equal((await lstat(join(root, ".omcs"))).mode & 0o777, 0o700);
			assert.equal((await lstat(join(root, ".omcs", "runs"))).mode & 0o777, 0o700);
			assert.equal((await readFile(path, "utf8")), `${JSON.stringify(receipt(), null, "\t")}\n`);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("creates each receipt without clobbering an existing run file", async () => {
		const root = await fixture();
		try {
			const [first, second] = await Promise.all([writeRunReceipt(root, receipt()), writeRunReceipt(root, receipt())]);
			assert.notEqual(first, second);
			assert.equal((await lstat(first)).nlink, 1);
			assert.equal((await lstat(second)).nlink, 1);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses symlinked, hardlinked, and non-directory receipt path entries", async () => {
		const root = await fixture();
		try {
			const outside = join(root, "outside");
			await mkdir(outside);
			await symlink(outside, join(root, ".omcs"));
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|symlink/i);
			await rm(join(root, ".omcs"));
			await writeFile(join(root, ".omcs"), "not a directory");
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|directory/i);
			await rm(join(root, ".omcs"));
			await mkdir(join(root, ".omcs"));
			await writeFile(join(root, ".omcs", "runs"), "not a directory");
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|directory/i);
			await rm(join(root, ".omcs", "runs"));
			const target = join(root, "target");
			await writeFile(target, "private data");
			await link(target, join(root, ".omcs", "runs"));
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|link|directory/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects unsafe receipt fields instead of serializing secrets, paths, or raw output", async () => {
		const root = await fixture();
		try {
			const unsafe = [
				receipt({ verification: [{ command: "TOKEN=not-safe npm test", outcome: "passed" }] }),
				receipt({ verification: [{ command: "npm test $HOME", outcome: "passed" }] }),
				receipt({ verification: [{ command: "npm test /Users/rafa/private", outcome: "passed" }] }),
				receipt({ verification: [{ command: "curl https://user:pass@example.test", outcome: "passed" }] }),
				receipt({ verification: [{ command: "node -e console.log(receipt)", outcome: "passed" }] }),
				receipt({ verification: [{ command: "npm test; cat output", outcome: "passed" }] }),
				{ ...receipt(), token: "not-safe" },
				{ ...receipt(), review: { verdict: "ship", providerCredential: "not-safe" } },
				{ ...receipt(), skills: ["tdd".repeat(80)] },
				{ ...receipt(), agents: ["not-a-catalog-agent"] },
				{ ...receipt(), verification: Array.from({ length: 33 }, () => ({ command: "npm test", outcome: "passed" })) },
			];
			for (const candidate of unsafe) await assert.rejects(writeRunReceipt(root, candidate as OrchestrationReceipt), /receipt|unsafe|invalid/i);
			await assert.rejects(lstat(join(root, ".omcs", "runs")), { code: "ENOENT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("refuses a symlinked ancestor instead of writing through it", async () => {
		const parent = await fixture();
		const outside = await fixture();
		const root = join(parent, "project");
		try {
			await symlink(outside, root);
			await assert.rejects(writeRunReceipt(root, receipt()), /unsafe|ancestor|symlink/i);
			await assert.rejects(lstat(join(outside, ".omcs")), { code: "ENOENT" });
		} finally {
			await chmod(parent, 0o700).catch(() => undefined);
			await rm(parent, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
