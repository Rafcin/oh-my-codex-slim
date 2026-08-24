import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const cli = join(process.cwd(), "dist", "cli", "omcs.js");

describe("strict OMCS command parsing", () => {
	for (const args of [["status", "--bogus"], ["agents", "list", "trailing"], ["setup", "--dry-run", "--dry-run"], ["agents", "check", "--dry-run"], ["help", "--json"]]) {
		it(`rejects ${args.join(" ")}`, () => {
			const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
			assert.equal(result.status, 64);
			assert.match(result.stderr, /^omcs: invalid arguments/);
		});
	}

	it("catches and redacts unexpected top-level failures", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-cli-secret-value-"));
		try {
			await symlink(join(root, "missing"), join(root, "codex-home"));
			const result = spawnSync(process.execPath, [cli, "setup", "--dry-run"], {
				encoding: "utf8", env: { PATH: process.env.PATH, CODEX_HOME: join(root, "codex-home") },
			});
			assert.equal(result.status, 1);
			assert.equal(result.stderr, "omcs: command failed safely\n");
			assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-value|stack|symlinked/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
