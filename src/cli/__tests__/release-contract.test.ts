import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

test("release documentation and package surface are slim, attributed, and offline", async () => {
	const root = process.cwd();
	const packageDocument = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	) as { scripts?: Record<string, string>; files?: string[] };
	assert.equal(
		packageDocument.scripts?.["verify:release"],
		"node --experimental-strip-types src/scripts/verify-release.ts",
	);
	for (const required of [
		".agents/plugins/marketplace.json",
		"plugins/oh-my-codex-slim/",
		"dist/runtime/run-loop.js",
		"dist/runtime/run-outcome.js",
		"dist/runtime/terminal-lifecycle.js",
		"dist/config/omcs-config.js",
		"dist/config/project-config.js",
		"dist/cli/config.js",
		"dist/orchestration/policy.js",
		"dist/orchestration/declaration.js",
		"dist/orchestration/receipt.js",
		"schema/omcs.schema.json",
			"README.md",
			"docs/opencodex.md",
			"THIRD_PARTY_NOTICES.md",
			".upstream-revisions.json",
	]) {
		assert.ok(
			packageDocument.files?.includes(required),
			`missing packaged ${required}`,
		);
	}
	const packed = spawnSync("npm", ["pack", "--json", "--dry-run"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(packed.status, 0, packed.stderr || packed.stdout);
	const packedPaths = new Set(
		(JSON.parse(packed.stdout) as Array<{ files?: Array<{ path?: unknown }> }>)[0]?.files
			?.map((file) => file.path)
			.filter((path): path is string => typeof path === "string") ?? [],
	);
	assert.equal([...packedPaths].some((path) => path.startsWith("dist/router/")), false, "Router runtime must remain repository-only");
	for (const required of [
		"dist/cli/omcs.js",
		"dist/cli/index.js",
		"dist/cli/doctor.js",
		"dist/cli/plugin-registration.js",
		"dist/config/omcs-config.js",
		"dist/config/project-config.js",
		"dist/orchestration/policy.js",
		"dist/orchestration/receipt.js",
			"schema/omcs.schema.json",
			".upstream-revisions.json",
		]) assert.equal(packedPaths.has(required), true, `missing packaged ${required}`);

	const isolated = await mkdtemp(join(tmpdir(), "omcs-cli-without-router-"));
	try {
		await cp(join(root, "dist"), join(isolated, "dist"), {
			recursive: true,
			filter: (source) => !source.includes(`${join("dist", "router")}`),
		});
		await symlink(join(root, "node_modules"), join(isolated, "node_modules"), "dir");
		const result = spawnSync(process.execPath, [join(isolated, "dist", "cli", "omcs.js"), "--help"], {
			cwd: isolated,
			encoding: "utf8",
			env: { PATH: process.env.PATH },
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /OMCS management CLI/);
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
	const documentation = await Promise.all(
		[
			"README.md",
			"docs/installation.md",
			"docs/architecture.md",
			"docs/opencodex.md",
			"docs/troubleshooting.md",
		].map((path) => readFile(join(root, path), "utf8")),
	);
	const joined = documentation.join("\n");
	for (const identity of [
		"Yeachan Heo",
		"Alvin",
		"Matt Pocock",
		"Daniel McAteer",
		"codex-router contributors",
		"duolahypercho",
		"opencodex contributors",
		"lidge-jun",
		"Herrington Darkholme",
		"HerringtonDarkholme",
		"ast-grep",
		"code-yeongyu",
	]) {
		assert.match(
			joined,
			new RegExp(identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
	}
	assert.match(joined, /THIRD_PARTY_NOTICES\.md/);
	assert.match(joined, /oh-my-codex-slim@omcs-local/);
	assert.match(joined, /OpenCodex is the supported external-model transport/i);
	assert.match(joined, /owns provider authentication/i);
	assert.match(joined, /real model.*explicit approval/is);
	assert.match(joined, /legacy Codex Router compatibility/i);
	assert.doesNotMatch(joined, /omcs migrate opencodex --rollback/i);
	assert.match(joined, /\.omcs\/release\/oh-my-codex-slim-0\.1\.0-SHA256\.tgz/);
	assert.match(joined, /npm publish --access public \.\/\.omcs\/release\//);
	assert.match(joined, /never rebuild/i);
	for (const prohibited of [
		"requires tmux",
		"telemetry is enabled",
		"requires an OpenCode runtime",
		"runs an automatic update check",
	])
		assert.doesNotMatch(joined, new RegExp(prohibited, "i"));
});
