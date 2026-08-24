import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
		"README.md",
		"docs/opencodex.md",
		"THIRD_PARTY_NOTICES.md",
	]) {
		assert.ok(
			packageDocument.files?.includes(required),
			`missing packaged ${required}`,
		);
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
	for (const prohibited of [
		"requires tmux",
		"telemetry is enabled",
		"requires an OpenCode runtime",
		"runs an automatic update check",
	])
		assert.doesNotMatch(joined, new RegExp(prohibited, "i"));
});
