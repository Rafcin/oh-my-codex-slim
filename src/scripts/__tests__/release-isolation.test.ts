import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReleaseEnvironment } from "../release-environment.js";

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
	});
});
