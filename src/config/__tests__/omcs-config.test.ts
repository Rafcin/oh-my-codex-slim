import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	DEFAULT_OMCS_CONFIG,
	findProjectConfig,
	parseOmcsConfig,
	resolveOmcsConfig,
} from "../omcs-config.js";

async function fixture(): Promise<{ root: string; cwd: string; codexHome: string; globalPath: string; projectPath: string }> {
	const root = await mkdtemp(join(tmpdir(), "omcs-config-"));
	const cwd = join(root, "repository", "nested", "working");
	const codexHome = join(root, "codex-home");
	const globalPath = join(codexHome, "omcs", "config.json");
	const projectPath = join(root, "repository", "omcs.config.json");
	await mkdir(cwd, { recursive: true });
	await mkdir(join(root, "repository", ".git"));
	return { root, cwd, codexHome, globalPath, projectPath };
}

describe("OMCS configuration", () => {
	it("parses the version-one defaults and every execution profile", () => {
		assert.deepEqual(DEFAULT_OMCS_CONFIG, {
			version: 1,
			profile: "auto",
			approvals: "material",
			antiSlop: true,
			visibleProgress: true,
		});
		for (const profile of ["auto", "fast", "thorough", "council"]) {
			assert.deepEqual(parseOmcsConfig(Buffer.from(`{"version":1,"profile":"${profile}"}`), "project"), {
				version: 1,
				profile,
			});
		}
	});

	it("rejects unknown keys, unsupported versions, and oversized values", () => {
		assert.throws(() => parseOmcsConfig(Buffer.from('{"version":1,"token":"secret"}'), "project"), /project|unknown|invalid/i);
		assert.throws(() => parseOmcsConfig(Buffer.from('{"version":2}'), "global"), /global|version|invalid/i);
		assert.throws(() => parseOmcsConfig(Buffer.alloc(64 * 1024 + 1), "project"), /64|large|size/i);
	});

	it("uses project policy over global preferences and session over project policy", async () => {
		const { root, cwd, codexHome, globalPath, projectPath } = await fixture();
		try {
			await mkdir(join(codexHome, "omcs"), { recursive: true });
			await writeFile(globalPath, '{"version":1,"profile":"fast","antiSlop":false}');
			await writeFile(projectPath, '{"version":1,"profile":"thorough","approvals":"always"}');
			assert.equal((await resolveOmcsConfig({ cwd, codexHome })).effective.profile, "thorough");
			assert.deepEqual((await resolveOmcsConfig({ cwd, codexHome, session: { profile: "council" } })).sources, {
				defaults: true,
				global: globalPath,
				project: projectPath,
				session: true,
			});
			assert.deepEqual((await resolveOmcsConfig({ cwd, codexHome, session: { profile: "council" } })).effective, {
				version: 1,
				profile: "council",
				approvals: "always",
				antiSlop: false,
				visibleProgress: true,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses safe defaults when no global or project configuration exists", async () => {
		const { root, cwd, codexHome } = await fixture();
		try {
			assert.deepEqual(await resolveOmcsConfig({ cwd, codexHome }), {
				effective: DEFAULT_OMCS_CONFIG,
				sources: { defaults: true, global: null, project: null, session: false },
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses symlinked and hardlinked configuration files", async () => {
		const { root, cwd, codexHome, globalPath, projectPath } = await fixture();
		try {
			await mkdir(join(codexHome, "omcs"), { recursive: true });
			await writeFile(join(root, "global-owned.json"), '{"version":1}');
			await symlink(join(root, "global-owned.json"), globalPath);
			await assert.rejects(resolveOmcsConfig({ cwd, codexHome }), /unsafe|symbolic|link/i);
			await rm(globalPath);
			await writeFile(projectPath, '{"version":1}');
			await link(projectPath, join(root, "repository", "linked-copy.json"));
			await assert.rejects(resolveOmcsConfig({ cwd, codexHome }), /unsafe|link/i);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("finds only the nearest Git-root policy without walking beyond the cwd filesystem", async () => {
		const { root, cwd, projectPath } = await fixture();
		try {
			await writeFile(projectPath, '{"version":1}');
			assert.equal(await findProjectConfig(cwd), projectPath);
			await rm(projectPath);
			assert.equal(await findProjectConfig(cwd), null);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
