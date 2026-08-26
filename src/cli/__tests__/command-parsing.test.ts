import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as cliIndex from "../index.js";

const cli = join(process.cwd(), "dist", "cli", "omcs.js");

describe("strict OMCS command parsing", () => {
	it("symbolizes absolute config, doctor, and status paths before shareable output", () => {
		const symbolize = (cliIndex as { symbolizeShareableOutput?: (value: unknown, context: unknown) => unknown }).symbolizeShareableOutput;
		assert.equal(typeof symbolize, "function");
		const localRoot = join("/", "Users", "fixture-user");
		assert.deepEqual(symbolize!({
			config: join(localRoot, "project", "omcs.config.json"),
			doctor: join(localRoot, "package", ".agents", "plugins", "marketplace.json"),
			status: join(localRoot, ".codex", "oh-my-codex-slim", "config.json"),
			external: join(localRoot, "outside", "omcs.config.json"),
		}, {
			cwd: join(localRoot, "project"),
			projectRoot: join(localRoot, "project"),
			codexHome: join(localRoot, ".codex"),
			packageRoot: join(localRoot, "package"),
		}), {
			config: "project:omcs.config.json",
			doctor: "package:marketplace.json",
			status: "${CODEX_HOME}/oh-my-codex-slim/config.json",
			external: "local:omcs.config.json",
		});
	});

	it("advertises only reachable management commands", () => {
		const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH } });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /omcs configure/);
		assert.doesNotMatch(result.stdout, /migrate|rollback/i);
	});

	for (const args of [["status", "--bogus"], ["agents", "list", "trailing"], ["setup", "--dry-run", "--dry-run"], ["agents", "check", "--dry-run"], ["help", "--json"], ["configure", "--scope", "project", "--scope", "global", "--profile", "auto"], ["configure", "--scope", "project", "--profile", "unknown"], ["configure", "--scope", "session", "--profile", "fast", "--update"], ["config", "show", "--effective", "trailing"], ["config", "validate", "one", "two"], ["config", "show", "--json", "--bogus"]]) {
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
