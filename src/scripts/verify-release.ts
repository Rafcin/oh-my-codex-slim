import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const APPROVED_PACKED_MANIFEST = [
	".upstream-revisions.json",
	".agents/plugins/marketplace.json",
	"LICENSE", "README.md", "THIRD_PARTY_NOTICES.md",
	"dist/agents/catalog.js", "dist/agents/install.js",
	"dist/cli/agents-lifecycle.js", "dist/cli/config.js", "dist/cli/doctor.js", "dist/cli/index.js", "dist/cli/mcp-health.js", "dist/cli/omcs.js", "dist/cli/package-root.js", "dist/cli/plugin-marketplace.js", "dist/cli/plugin-registration.js", "dist/cli/setup.js", "dist/cli/shareable-output.js", "dist/cli/status.js", "dist/cli/uninstall.js", "dist/cli/update.js",
	"dist/config/codex-home.js", "dist/config/generator.js", "dist/config/managed-files.js", "dist/config/omcs-config.js", "dist/config/project-config.js", "dist/config/safe-reader.js",
	"dist/mcp/ast.js", "dist/mcp/codemap.js", "dist/mcp/lsp.js", "dist/mcp/server.js",
	"dist/orchestration/declaration.js", "dist/orchestration/packets.js", "dist/orchestration/policy.js", "dist/orchestration/receipt.js", "dist/orchestration/risk.js",
	"dist/runtime/run-loop.js", "dist/runtime/run-outcome.js", "dist/runtime/terminal-lifecycle.js", "dist/scripts/public-secret-scan.js",
	"docs/agents-and-skills.md", "docs/architecture.md", "docs/assets/omcs-config-precedence.svg", "docs/assets/omcs-configure-project.png", "docs/assets/omcs-pipeline.svg", "docs/assets/omcs-route-declaration.png", "docs/assets/omcs-routing.svg", "docs/assets/omcs-verification-receipt.png", "docs/configuration.md", "docs/diagrams/omcs-config-precedence.mmd", "docs/diagrams/omcs-pipeline.mmd", "docs/diagrams/omcs-routing.mmd", "docs/examples.md", "docs/execution-modes.md", "docs/installation.md", "docs/opencodex.md", "docs/troubleshooting.md", "docs/upstream-sources.md",
	"package.json",
	"plugins/oh-my-codex-slim/.app.json", "plugins/oh-my-codex-slim/.codex-plugin/plugin.json", "plugins/oh-my-codex-slim/.mcp.json", "plugins/oh-my-codex-slim/hooks/hooks.json", "plugins/oh-my-codex-slim/hooks/omcs-hook.mjs", "plugins/oh-my-codex-slim/skills/.omcs-sync-manifest.json",
	"plugins/oh-my-codex-slim/skills/ai-slop-cleaner/SKILL.md", "plugins/oh-my-codex-slim/skills/code-review/SKILL.md", "plugins/oh-my-codex-slim/skills/codebase-design/SKILL.md", "plugins/oh-my-codex-slim/skills/codemap/SKILL.md", "plugins/oh-my-codex-slim/skills/codemap/references/clone-dependency.md", "plugins/oh-my-codex-slim/skills/context/SKILL.md", "plugins/oh-my-codex-slim/skills/deep-interview/SKILL.md", "plugins/oh-my-codex-slim/skills/deepwork/SKILL.md", "plugins/oh-my-codex-slim/skills/deepwork/references/worktrees.md", "plugins/oh-my-codex-slim/skills/diagnose/SKILL.md", "plugins/oh-my-codex-slim/skills/implement/SKILL.md", "plugins/oh-my-codex-slim/skills/omcs-orchestrate/SKILL.md", "plugins/oh-my-codex-slim/skills/omcs/SKILL.md", "plugins/oh-my-codex-slim/skills/plan/SKILL.md", "plugins/oh-my-codex-slim/skills/research/SKILL.md", "plugins/oh-my-codex-slim/skills/simplify/SKILL.md", "plugins/oh-my-codex-slim/skills/tdd/SKILL.md", "plugins/oh-my-codex-slim/skills/verification/SKILL.md",
	"schema/omcs.schema.json",
] as const;

/** Rejects every package change until the reviewed public manifest is updated deliberately. */
export function assertApprovedPackedManifest(paths: readonly string[]): void {
	const approved = new Set(APPROVED_PACKED_MANIFEST);
	const actual = new Set(paths);
	if (actual.size !== paths.length) throw new Error("npm artifact contains duplicate path entries");
	for (const path of APPROVED_PACKED_MANIFEST) if (!actual.has(path)) throw new Error(`npm artifact is missing ${path}`);
	for (const path of paths) if (!approved.has(path as typeof APPROVED_PACKED_MANIFEST[number])) throw new Error(`npm artifact contains unexpected ${path}`);
}

function allowed(file: string, args: string[], artifactDirectory: string): boolean {
	if (file === "npm") return (args[0] === "run" && ["build", "lint", "test", "verify:skills", "verify:docs", "verify:secrets"].includes(args[1] ?? ""))
		|| (args.length === 1 && args[0] === "test")
		|| (args.length === 4 && args[0] === "pack" && args[1] === "--json" && args[2] === "--pack-destination" && args[3] === artifactDirectory);
	if (file !== process.execPath) return false;
	if (args[0] === "--test") return args.slice(1).every((arg) => /^dist\/[a-z0-9_./-]+\.test\.js$/i.test(arg));
	return args.length === 2
		&& args[0] === "dist/scripts/validate-plugin.js"
		&& args[1] === "plugins/oh-my-codex-slim";
}

function ensureSafeDirectory(path: string, privateDirectory: boolean): void {
	try {
		mkdirSync(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const state = lstatSync(path);
	if (state.isSymbolicLink() || !state.isDirectory() || (privateDirectory && (state.mode & 0o077) !== 0)) {
		throw new Error("verify:release refused an unsafe approved artifact directory");
	}
}

async function main(): Promise<void> {
	const releaseEnvironmentModule = "./release-environment.ts";
	const { buildReleaseEnvironment } = await import(releaseEnvironmentModule) as typeof import("./release-environment.js");
	const publicSecretScanModule = "./public-secret-scan.ts";
	const { preserveNpmPackageArtifact, resolvePublicRepositoryRoot, scanNpmPackageArtifact } = await import(publicSecretScanModule) as typeof import("./public-secret-scan.js");
	const root = resolvePublicRepositoryRoot(process.cwd());
	const isolatedRoot = mkdtempSync(join(tmpdir(), "omcs-release-"));
	const artifactDirectory = join(isolatedRoot, "artifact");
	const privateStateDirectory = join(root, ".omcs");
	const approvedArtifactDirectory = join(root, ".omcs", "release");
	const environment = await buildReleaseEnvironment(process.env, isolatedRoot, process.execPath);
	for (const path of [environment.HOME, environment.CODEX_HOME, environment.TMPDIR, environment.npm_config_cache, environment.npm_config_prefix]) {
		if (path) mkdirSync(path, { recursive: true });
	}
	writeFileSync(environment.npm_config_userconfig!, "", { mode: 0o600 });
	mkdirSync(artifactDirectory, { mode: 0o700 });

	function run(file: string, args: string[]): string {
		if (!allowed(file, args, artifactDirectory)) throw new Error(`verify:release refused an unapproved command boundary: ${file}`);
		process.stdout.write(`release gate: ${file} ${args.join(" ")}\n`);
		return execFileSync(file, args, { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
	}

	try {
		run("npm", ["run", "build"]);
		run("npm", ["run", "lint"]);
		run("npm", ["test"]);
		run(process.execPath, ["--test",
			"dist/cli/__tests__/command-parsing.test.js", "dist/cli/__tests__/lifecycle.test.js", "dist/cli/__tests__/plugin-registration.test.js", "dist/cli/__tests__/release-contract.test.js", "dist/cli/__tests__/setup-ownership.test.js",
			"dist/agents/__tests__/catalog.test.js", "dist/agents/__tests__/definitions.test.js", "dist/orchestration/__tests__/risk.test.js", "dist/orchestration/__tests__/packets.test.js", "dist/catalog/__tests__/skill-sync.test.js", "dist/catalog/__tests__/skills.test.js", "dist/config/__tests__/safe-reader.test.js", "dist/mcp/__tests__/server.test.js", "dist/mcp/__tests__/path-security.test.js", "dist/router/__tests__/adapter.test.js", "dist/router/__tests__/migrate-opencodex.test.js", "dist/router/__tests__/migration-manifest.test.js", "dist/scripts/__tests__/release-isolation.test.js", "dist/scripts/__tests__/public-secret-scan.test.js", "dist/scripts/__tests__/validate-plugin.test.js",
		]);
		run("npm", ["run", "verify:skills"]);
		run("npm", ["run", "verify:docs"]);
		run("npm", ["run", "verify:secrets"]);
		run(process.execPath, ["dist/scripts/validate-plugin.js", "plugins/oh-my-codex-slim"]);
		const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", artifactDirectory])) as Array<{ filename?: unknown }>;
		const filename = packed[0]?.filename;
		if (typeof filename !== "string" || basename(filename) !== filename || !/^[A-Za-z0-9._-]+\.tgz$/.test(filename)) {
			throw new Error("verify:release received an unsafe npm artifact filename");
		}
		const artifactPath = join(artifactDirectory, filename);
		chmodSync(artifactPath, 0o600);
		const artifact = await scanNpmPackageArtifact(artifactPath);
		assertApprovedPackedManifest(artifact.paths);
		if (artifact.findings.length > 0) {
			for (const finding of artifact.findings) process.stderr.write(`release artifact: ${finding.path} [${finding.rule}]\n`);
			throw new Error("verify:release refused an npm artifact with public-secret findings");
		}
		ensureSafeDirectory(privateStateDirectory, false);
		ensureSafeDirectory(approvedArtifactDirectory, true);
		const approvedFilename = `${filename.slice(0, -4)}-${artifact.sha256}.tgz`;
		const approvedArtifactPath = join(approvedArtifactDirectory, approvedFilename);
		await preserveNpmPackageArtifact(artifactPath, approvedArtifactPath, artifact);
		const approvedRelativePath = relative(root, approvedArtifactPath).split(sep).join("/");
		process.stdout.write(`release gate: approved artifact ${approvedRelativePath}\n`);
		process.stdout.write(`release gate: artifact sha256 ${artifact.sha256}\n`);
		process.stdout.write("verify:release passed every offline OMCS gate; fresh App/CLI discovery and any billed smoke remain separate.\n");
	} finally {
		rmSync(isolatedRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
