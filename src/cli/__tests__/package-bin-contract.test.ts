import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("slim package binary contract", () => {
  it("prevents publishing the legacy omx binary instead of the omcs executable", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      bin?: unknown;
      engines?: { node?: unknown };
      name?: unknown;
      version?: unknown;
      type?: unknown;
      license?: unknown;
    };

    assert.deepEqual(pkg.bin, { omcs: "dist/cli/omcs.js" });
    assert.equal(pkg.name, "oh-my-codex-slim");
    assert.equal(pkg.version, "0.1.0");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.engines?.node, ">=22.19.0");
    assert.equal(pkg.license, "MIT");
    assert.equal(existsSync(join(process.cwd(), "dist", "cli", "omcs.js")), true);
    assert.match(readFileSync(join(process.cwd(), "dist", "cli", "omcs.js"), "utf8"), /^#!\/usr\/bin\/env node/);
  });

  it("packs an executable omcs artifact", () => {
    const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packed = JSON.parse(result.stdout) as Array<{
      name?: unknown;
      version?: unknown;
      files?: Array<{ path?: unknown; mode?: unknown }>;
    }>;
    assert.equal(packed[0]?.name, "oh-my-codex-slim");
    assert.equal(packed[0]?.version, "0.1.0");
    const executable = packed[0]?.files?.find((file) => file.path === "dist/cli/omcs.js");
    assert.equal(executable?.mode, 0o755);
  });

  it("does not pack retired telemetry, external adapters, or Rust builders", () => {
    const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packed = JSON.parse(result.stdout) as Array<{
      files?: Array<{ path?: unknown }>;
    }>;
    const packedPaths = new Set(
      packed[0]?.files
        ?.map((file) => file.path)
        .filter((path): path is string => typeof path === "string"),
    );
    const retiredArtifacts = [
      "dist/mcp/lifecycle-telemetry.js",
      "dist/notifications/notifier.js",
      "dist/notifications/http-client.js",
      "dist/notifications/dispatch-cooldown.js",
      "dist/cli/ask.js",
      "dist/scripts/run-provider-advisor.js",
      "dist/scripts/test-reply-listener-live.js",
      "dist/scripts/build-sparkshell.js",
      "dist/scripts/build-explore-harness.js",
      "dist/scripts/build-api.js",
      "dist/scripts/test-sparkshell.js",
      "dist/scripts/check-version-sync.js",
    ];
    for (const artifact of retiredArtifacts) {
      assert.equal(packedPaths.has(artifact), false, `packed artifact must not retain ${artifact}`);
    }
  });

  it("does not publish compiled tests or test-only artifacts", () => {
    const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packed = JSON.parse(result.stdout) as Array<{
      files?: Array<{ path?: unknown }>;
    }>;
    const packedPaths = packed[0]?.files
      ?.map((file) => file.path)
      .filter((path): path is string => typeof path === "string") ?? [];
    const testArtifact = /(?:^|\/)__tests__(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.(?:js|d\.ts)(?:\.map)?$/;

    assert.equal(
      packedPaths.filter((path) => testArtifact.test(path)).length,
      0,
      "published artifact must exclude compiled tests and their declarations/maps",
    );
    assert.equal(packedPaths.includes("dist/cli/omcs.js"), true, "published artifact must retain the CLI");
    assert.equal(
      packedPaths.includes("dist/config/generator.js"),
      true,
      "published artifact must retain production runtime modules",
    );
  });
});
