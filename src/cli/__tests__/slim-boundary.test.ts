import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfig } from "../../config/generator.js";
import { doctor } from "../doctor.js";
import { setup } from "../setup.js";
import { uninstall } from "../uninstall.js";

describe("slim runtime boundary", () => {
  it("prevents terminal and unrelated runtimes from shipping with the Codex-native product", () => {
    const prohibitedPaths = [
      "crates",
      "geobench",
      "packages/vscode-extension",
      "src/adapt",
      "src/auth",
      "src/hud",
      ["src/", "open", "claw"].join(""),
      "src/sidecar",
      "src/team",
      "src/vscode",
    ];
    for (const path of prohibitedPaths) {
      assert.equal(existsSync(join(process.cwd(), path)), false, path);
    }

    const pkg = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const disallowedRuntimeTerms = [
      ["t", "mux"].join(""),
      ["ze", "llij"].join(""),
      ["open", "claw"].join(""),
    ];
    assert.doesNotMatch(pkg, new RegExp(disallowedRuntimeTerms.join("|"), "i"));
  });

	it("keeps private run state and scratch reports out of the tracked source tree", () => {
		const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: process.cwd(), encoding: "buffer" })
			.toString("utf8")
			.split("\0")
			.filter(Boolean);
		assert.deepEqual(tracked.filter((path) => /^(?:\.superpowers\/sdd\/|\.omcs\/|\.gjc\/)/.test(path)), []);
	});

  it("handles the setup dry run without forwarding it to Codex", async () => {
    const temporaryDirectory = await mkdtemp(join(await realpath(tmpdir()), "omcs-router-smoke-"));
    const stubPath = join(temporaryDirectory, "codex");
    const markerPath = join(temporaryDirectory, "codex-was-called");
    try {
      await writeFile(stubPath, "#!/bin/sh\nprintf forwarded > \"$OMCS_STUB_MARKER\"\nexit 91\n", "utf8");
      await chmod(stubPath, 0o755);
      const result = spawnSync(
        process.execPath,
        [join(process.cwd(), "dist", "cli", "omcs.js"), "setup", "--dry-run", "--json"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CODEX_HOME: join(temporaryDirectory, "codex-home"),
            OMCS_STUB_MARKER: markerPath,
            PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(markerPath), false, "management commands must not be forwarded to Codex");
      assert.deepEqual(JSON.parse(result.stdout), {
        command: "setup",
        dryRun: true,
        changed: [
          "config.toml",
          "agents/omcs-architect.toml",
          "agents/omcs-designer.toml",
          "agents/omcs-explorer.toml",
          "agents/omcs-fixer.toml",
          "agents/omcs-librarian.toml",
          "agents/omcs-oracle.toml",
          "agents/omcs-reviewer.toml",
          "agents/omcs-terra-fixer.toml",
        ],
        unchanged: [],
        conflicts: [],
        backups: [],
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("replaces only the OMCS-owned configuration block", () => {
    const existing = [
      "[user]",
      'preference = "keep"',
      "# omcs:begin",
      "old = true",
      "# omcs:end",
      "",
    ].join("\n");

    assert.equal(
      mergeConfig(existing, "[omcs]\nenabled = true\n"),
      [
        "[user]",
        'preference = "keep"',
        "# omcs:begin",
        "[omcs]",
        "enabled = true",
        "# omcs:end",
        "",
      ].join("\n"),
    );
  });

  it("reports an unsupported Node version without probing user configuration", async () => {
    const readOnlyDoctor = doctor as unknown as (options: { nodeVersion: string }) => Promise<{
      ok: boolean;
      errors: string[];
    }>;
    const report = await readOnlyDoctor({ nodeVersion: "v20.0.0" });
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, ["Node.js >=22.19.0 is required (found v20.0.0)."]);
  });

  it("preserves an existing unowned Codex config while planning the reserved OMCS block", async () => {
    const codexHome = await mkdtemp(join(await realpath(tmpdir()), "omcs-setup-preflight-"));
    try {
      const configPath = join(codexHome, "config.toml");
      await writeFile(configPath, '[user]\npreference = "keep"\n', "utf8");
      const preflightSetup = setup as unknown as (options: { codexHome: string; dryRun: boolean }) => Promise<{
        changed: string[];
        unchanged: string[];
        conflicts: string[];
        backups: string[];
      }>;
      const preview = await preflightSetup({ codexHome, dryRun: true });
      assert.deepEqual({ ...preview, backups: [] }, {
        changed: [
          "config.toml",
          "agents/omcs-architect.toml",
          "agents/omcs-designer.toml",
          "agents/omcs-explorer.toml",
          "agents/omcs-fixer.toml",
          "agents/omcs-librarian.toml",
          "agents/omcs-oracle.toml",
          "agents/omcs-reviewer.toml",
          "agents/omcs-terra-fixer.toml",
        ],
        unchanged: [],
        conflicts: [],
        backups: [],
      });
			assert.equal(preview.backups.length, 1);
			assert.match(preview.backups[0] ?? "", /^config\.toml\.bak-/);
      assert.equal(await readFileSync(configPath, "utf8"), '[user]\npreference = "keep"\n');
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  it("refuses to uninstall an unowned Codex config", async () => {
    const codexHome = await mkdtemp(join(await realpath(tmpdir()), "omcs-uninstall-preflight-"));
    try {
      await writeFile(join(codexHome, "config.toml"), '[user]\npreference = "keep"\n', "utf8");
      const preflightUninstall = uninstall as unknown as (options: { codexHome: string; dryRun: boolean }) => Promise<{
        changed: string[];
        unchanged: string[];
        conflicts: string[];
        backups: string[];
      }>;
      assert.deepEqual(await preflightUninstall({ codexHome, dryRun: true }), {
        changed: [],
        unchanged: [],
        conflicts: ["config.toml"],
        backups: [],
      });
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  it("uses only the pinned packaged ast-grep executable without download fallback", async () => {
		const codeIntel = await import(`../../mcp/ast.js?boundary=${Date.now()}`) as Record<string, unknown>;
		assert.equal(typeof codeIntel.resolvePinnedAstGrepExecutable, "function");
		const resolvePinnedAstGrepExecutable = codeIntel.resolvePinnedAstGrepExecutable as () => string;
		const executable = resolvePinnedAstGrepExecutable();
		assert.match(executable, /node_modules[\\/]@ast-grep[\\/]cli[\\/]ast-grep(?:\.exe)?$/);
		assert.equal(JSON.parse(readFileSync(join(process.cwd(), "node_modules", "@ast-grep", "cli", "package.json"), "utf8")).version, "0.45.1");
		assert.doesNotMatch(readFileSync(join(process.cwd(), "dist", "mcp", "ast.js"), "utf8"), /\bnpx\b/);
  });

	it("ships no legacy MCP manifest regenerator or obsolete server catalog", () => {
		for (const path of [
			"src/scripts/sync-plugin-mirror.ts",
			"src/config/omx-first-party-mcp.ts",
			"dist/scripts/sync-plugin-mirror.js",
			"dist/config/omx-first-party-mcp.js",
		]) {
			assert.equal(existsSync(join(process.cwd(), path)), false, path);
		}
		const productionSource = readdirSync(join(process.cwd(), "src"), { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.parentPath.includes("__tests__"))
			.map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
			.join("\n");
		assert.doesNotMatch(productionSource, /omx_(?:state|memory|code_intel|trace|hermes)|buildOmxPluginMcpManifest|syncPluginMirror/);
	});

  it("uses the OMCS local marketplace identity without team or worker behavior", async () => {
    const marketplace = await import(`../plugin-marketplace.js?boundary=${Date.now()}`) as Record<string, unknown>;
    assert.equal(marketplace.OMCS_LOCAL_MARKETPLACE_NAME, "omcs-local");
    assert.equal(marketplace.OMCS_PLUGIN_NAME, "oh-my-codex-slim");
    assert.equal(marketplace.OMCS_LOCAL_PLUGIN_CONFIG_KEY, "oh-my-codex-slim@omcs-local");
    const compiled = readFileSync(join(process.cwd(), "dist", "cli", "plugin-marketplace.js"), "utf8");
    assert.doesNotMatch(compiled, /team|worker/i);
    assert.doesNotMatch(compiled, /oh-my-codex(?!-slim)/i);

    const packageRoot = await mkdtemp(join(tmpdir(), "omcs-marketplace-"));
    try {
      const pluginRoot = join(packageRoot, "plugins", "oh-my-codex-slim");
      await mkdir(join(packageRoot, ".agents", "plugins"), { recursive: true });
      await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
      await writeFile(
        join(packageRoot, ".agents", "plugins", "marketplace.json"),
        JSON.stringify({
          name: "omcs-local",
          plugins: [{
            name: "oh-my-codex-slim",
            source: { source: "local", path: "plugins/oh-my-codex-slim" },
          }],
        }),
      );
      await writeFile(
        join(pluginRoot, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "oh-my-codex-slim", version: "0.1.0", skills: "./skills/" }),
      );
      const resolvePackagedOmcsMarketplace = marketplace.resolvePackagedOmcsMarketplace as (root: string) => Promise<{
        pluginRoot: string;
      } | null>;
      assert.deepEqual(await resolvePackagedOmcsMarketplace(packageRoot), {
        marketplacePath: join(packageRoot, ".agents", "plugins", "marketplace.json"),
        packageRoot,
        pluginRoot,
        pluginManifestPath: join(pluginRoot, ".codex-plugin", "plugin.json"),
      });
      const omcsPluginCacheBase = marketplace.omcsPluginCacheBase as (codexHome: string) => string;
      assert.equal(
        omcsPluginCacheBase(join(packageRoot, "codex-home")),
        join(packageRoot, "codex-home", "plugins", "cache", "omcs-local", "oh-my-codex-slim"),
      );
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  it("ships no excluded runtime transport, telemetry, download, Rust, or legacy identity surface", async () => {
    const runtimeFiles: string[] = [];
		const packaged = JSON.parse(spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd(), encoding: "utf8" }).stdout) as Array<{ files: Array<{ path: string }> }>;
		const packagedRuntime = new Set(packaged[0]?.files.map((file) => file.path).filter((path) => path.startsWith("dist/") && path.endsWith(".js")) ?? []);
		runtimeFiles.splice(0, runtimeFiles.length, ...[...packagedRuntime].map((path) => join(process.cwd(), path)));
    const prohibited = /tmux|zellij|openclaw|@opencode|telemetry|analytics|claude|gemini|discord|telegram|\bnpx\b|sparkshell|explore-harness|\bcargo\b|crates\/|oh-my-codex(?!-slim)/i;
    for (const file of runtimeFiles) {
      assert.doesNotMatch(readFileSync(file, "utf8"), prohibited, file);
    }
  });
});
