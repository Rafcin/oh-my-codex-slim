import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReleaseEnvironment } from "../release-environment.js";
import { assertApprovedPackedManifest } from "../verify-release.js";

describe("release verification isolation", () => {
	it("constructs an allowlisted environment without ambient paths or credentials", async () => {
		const environment = await buildReleaseEnvironment({
			PATH: "/tmp/injected/bin", HOME: "/tmp/host-home", LANG: "en_US.UTF-8",
			OPENAI_API_KEY: "synthetic-secret", AWS_SESSION_TOKEN: "synthetic-session", ARBITRARY: "value",
		}, "/tmp/omcs-isolated", process.execPath);
		assert.equal(environment.HOME, "/tmp/omcs-isolated/home");
		assert.equal(environment.CODEX_HOME, "/tmp/omcs-isolated/codex-home");
		assert.doesNotMatch(environment.PATH ?? "", /injected|node_modules/);
		assert.equal(environment.OPENAI_API_KEY, undefined);
		assert.equal(environment.AWS_SESSION_TOKEN, undefined);
		assert.equal(environment.ARBITRARY, undefined);
		assert.equal(environment.GIT_CONFIG_VALUE_0, "false");
	});

	it("uses only the repository validator and never spreads the host environment", async () => {
		const source = await readFile(join(process.cwd(), "src", "scripts", "verify-release.ts"), "utf8");
		assert.doesNotMatch(source, /\.\.\.process\.env|homedir\(\)|\.codex.*validate_plugin/);
		assert.match(source, /buildReleaseEnvironment\(process\.env, isolatedRoot, process\.execPath\)/);
		assert.match(source, /dist\/scripts\/validate-plugin\.js/);
		assert.match(source, /dist\/config\/safe-reader\.js/);
		assert.match(source, /scanNpmPackageArtifact\(artifactPath\)/);
		assert.doesNotMatch(source, /pack[^\n]+--dry-run/);
	});

	it("packs the public OMCS runtime, policy, provenance, guides, diagrams, and redacted screenshots", () => {
		const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		assert.equal(packed.status, 0, packed.stderr);
		const paths = new Set((JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>)[0]?.files.map((file) => file.path));
		for (const required of [
			"dist/cli/omcs.js", "dist/config/omcs-config.js", "dist/orchestration/policy.js",
			"schema/omcs.schema.json", "docs/upstream-sources.md", "THIRD_PARTY_NOTICES.md",
			"docs/execution-modes.md", "docs/agents-and-skills.md", "docs/configuration.md", "docs/examples.md",
			"docs/diagrams/omcs-pipeline.mmd", "docs/diagrams/omcs-routing.mmd", "docs/diagrams/omcs-config-precedence.mmd",
			"docs/assets/omcs-pipeline.svg", "docs/assets/omcs-routing.svg", "docs/assets/omcs-config-precedence.svg",
			"docs/assets/omcs-configure-project.png", "docs/assets/omcs-route-declaration.png", "docs/assets/omcs-verification-receipt.png",
		]) assert.equal(paths.has(required), true, required);
	});

	it("rejects any package-manifest omission or unexpected public file", () => {
		const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd(), encoding: "utf8" });
		assert.equal(packed.status, 0, packed.stderr);
		const paths = (JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>)[0]?.files.map((file) => file.path) ?? [];
		assert.doesNotThrow(() => assertApprovedPackedManifest(paths));
		assert.throws(() => assertApprovedPackedManifest(paths.filter((path) => path !== "README.md")), /missing README\.md/);
		for (const unexpected of [
			"plugins/oh-my-codex-slim/extra.js", "docs/.envrc", "docs/superpowers/plan.md",
			"docs/assets/temp-render.svg", "dist/router/adapter.js", "private-key.pem", "extensionless-binary",
		]) assert.throws(() => assertApprovedPackedManifest([...paths, unexpected]), new RegExp(`unexpected ${unexpected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	});
});
