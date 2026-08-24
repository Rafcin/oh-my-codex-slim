import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseEnvironmentModule = "./release-environment.ts";
const { buildReleaseEnvironment } = await import(releaseEnvironmentModule) as typeof import("./release-environment.js");

const root = process.cwd();
const isolatedRoot = mkdtempSync(join(tmpdir(), "omcs-release-"));
const environment = await buildReleaseEnvironment(process.env, isolatedRoot, process.execPath);
for (const path of [environment.HOME, environment.CODEX_HOME, environment.TMPDIR, environment.npm_config_cache, environment.npm_config_prefix]) {
	if (path) mkdirSync(path, { recursive: true });
}
writeFileSync(environment.npm_config_userconfig!, "", { mode: 0o600 });

function allowed(file: string, args: string[]): boolean {
	if (file === "npm") return (args[0] === "run" && ["build", "lint", "test", "verify:skills"].includes(args[1] ?? ""))
		|| (args.length === 1 && args[0] === "test")
		|| (args[0] === "pack" && args.join(" ") === "pack --dry-run --json");
	if (file !== process.execPath) return false;
	if (args[0] === "--test") return args.slice(1).every((arg) => /^dist\/[a-z0-9_./-]+\.test\.js$/i.test(arg));
	return args.length === 2
		&& args[0] === "dist/scripts/validate-plugin.js"
		&& args[1] === "plugins/oh-my-codex-slim";
}

function run(file: string, args: string[]): string {
	if (!allowed(file, args)) throw new Error(`verify:release refused an unapproved command boundary: ${file}`);
	process.stdout.write(`release gate: ${file} ${args.join(" ")}\n`);
	return execFileSync(file, args, { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

try {
	run("npm", ["run", "build"]);
	run("npm", ["run", "lint"]);
	run("npm", ["test"]);
	run(process.execPath, ["--test",
		"dist/cli/__tests__/command-parsing.test.js",
		"dist/cli/__tests__/lifecycle.test.js",
		"dist/cli/__tests__/plugin-registration.test.js",
		"dist/cli/__tests__/release-contract.test.js",
		"dist/cli/__tests__/setup-ownership.test.js",
		"dist/agents/__tests__/catalog.test.js",
		"dist/agents/__tests__/definitions.test.js",
		"dist/orchestration/__tests__/risk.test.js",
		"dist/orchestration/__tests__/packets.test.js",
		"dist/catalog/__tests__/skill-sync.test.js",
		"dist/catalog/__tests__/skills.test.js",
		"dist/config/__tests__/safe-reader.test.js",
		"dist/mcp/__tests__/server.test.js",
		"dist/mcp/__tests__/path-security.test.js",
		"dist/router/__tests__/adapter.test.js",
		"dist/router/__tests__/migrate-opencodex.test.js",
		"dist/router/__tests__/migration-manifest.test.js",
		"dist/scripts/__tests__/release-isolation.test.js",
		"dist/scripts/__tests__/validate-plugin.test.js",
	]);
	run("npm", ["run", "verify:skills"]);
	run(process.execPath, ["dist/scripts/validate-plugin.js", "plugins/oh-my-codex-slim"]);
	const packed = JSON.parse(run("npm", ["pack", "--dry-run", "--json"])) as Array<{ files: Array<{ path: string }> }>;
	const paths = new Set(packed[0]?.files.map((file) => file.path) ?? []);
	for (const required of [
		"dist/cli/omcs.js", ".agents/plugins/marketplace.json",
		"dist/config/safe-reader.js",
		"plugins/oh-my-codex-slim/.codex-plugin/plugin.json", "README.md",
		"docs/installation.md", "docs/architecture.md", "docs/opencodex.md", "docs/troubleshooting.md",
		"LICENSE", "THIRD_PARTY_NOTICES.md",
	]) if (!paths.has(required)) throw new Error(`npm artifact is missing ${required}`);
	for (const path of paths) {
		if (/(__tests__|test\/fixtures|\.test\.|update-worker|tmux|opencode(?!x))/i.test(path)) throw new Error(`npm artifact contains prohibited legacy/test path: ${path}`);
	}
	if (paths.has("dist/mcp/clonedeps.js")) throw new Error("npm artifact exposes the legacy unbounded dependency-clone helper");
	process.stdout.write("verify:release passed every offline OMCS gate; fresh App/CLI discovery and any billed smoke remain separate.\n");
} finally {
	rmSync(isolatedRoot, { recursive: true, force: true });
}
