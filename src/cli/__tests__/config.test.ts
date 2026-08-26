import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { configureOmcs, showEffectiveConfig, validateOmcsConfigFile } from "../config.js";

const cli = join(process.cwd(), "dist", "cli", "omcs.js");

async function fixture(): Promise<{ root: string; cwd: string; codexHome: string }> {
	const root = await mkdtemp(join(tmpdir(), "omcs-cli-config-"));
	const cwd = join(root, "project", "nested", "working");
	const codexHome = join(root, "codex-home");
	await mkdir(cwd, { recursive: true });
	await mkdir(join(root, "project", ".git"), { recursive: true });
	return { root, cwd, codexHome };
}

describe("OMCS configuration commands", () => {
	it("configures project and global policy and exposes effective source paths without dumping config", async () => {
		const { root, cwd, codexHome } = await fixture();
		try {
			assert.equal((await configureOmcs({ scope: "project", profile: "auto", cwd, codexHome })).action, "create");
			assert.equal((await configureOmcs({ scope: "global", profile: "thorough", cwd, codexHome, dryRun: true })).action, "would-create");
			const shown = await showEffectiveConfig({ cwd, codexHome });
			assert.equal(shown.effectiveProfile, "auto");
			assert.equal(shown.sources.project, join(root, "project", "omcs.config.json"));
			assert.equal((await validateOmcsConfigFile(join(root, "project", "omcs.config.json"))).profile, "auto");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("keeps session configuration process-local and never writes a file", async () => {
		const { root, cwd, codexHome } = await fixture();
		try {
			const report = await configureOmcs({ scope: "session", profile: "fast", cwd, codexHome });
			assert.deepEqual(report, { scope: "session", action: "session", effectiveProfile: "fast" });
			await assert.rejects(readFile(join(root, "project", "omcs.config.json")), { code: "ENOENT" });
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("parses the documented CLI forms and emits stable JSON", async () => {
		const { root, cwd, codexHome } = await fixture();
		try {
			const env = { PATH: process.env.PATH, CODEX_HOME: codexHome };
			const configure = spawnSync(process.execPath, [cli, "configure", "--scope", "project", "--profile", "auto", "--json"], { cwd, encoding: "utf8", env });
			assert.equal(configure.status, 0);
			assert.deepEqual(JSON.parse(configure.stdout), { scope: "project", action: "create", path: join(await realpath(join(root, "project")), "omcs.config.json"), bytes: JSON.parse(configure.stdout).bytes, effectiveProfile: "auto" });
			const show = spawnSync(process.execPath, [cli, "config", "show", "--effective", "--json"], { cwd, encoding: "utf8", env });
			assert.equal(show.status, 0);
			assert.equal(JSON.parse(show.stdout).effectiveProfile, "auto");
			assert.doesNotMatch(show.stdout, /"quality"|"approval"|"orchestration"/);
			const validate = spawnSync(process.execPath, [cli, "config", "validate", "../../omcs.config.json", "--json"], { cwd, encoding: "utf8", env });
			assert.equal(validate.status, 0);
			assert.deepEqual(JSON.parse(validate.stdout).valid, true);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
