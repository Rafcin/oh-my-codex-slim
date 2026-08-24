import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
	access,
	chmod,
	link,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readRouterCapabilities } from "../adapter.js";
import { ROUTER_COMMANDS, runRouterCommand } from "../commands.js";
import type {
	CommandResult,
	RouterCommand,
	RouterCommandRunner,
	RouterProcessExecutor,
	RouterProcessOptions,
} from "../types.js";

type FixtureDocument = Partial<Record<RouterCommand, CommandResult>>;

const ROUTER_SYSTEM_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

async function expectedRouterPath(): Promise<string> {
	const runningNodeDirectory = dirname(await realpath(process.execPath));
	return [...new Set([runningNodeDirectory, ...ROUTER_SYSTEM_DIRECTORIES])].join(":");
}

async function fixtureRunner(name: string): Promise<RouterCommandRunner> {
	const path = fileURLToPath(
		new URL(`../../../test/fixtures/router/${name}.json`, import.meta.url),
	);
	const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureDocument;
	return async (command) =>
		fixture[command] ?? {
			ok: false,
			code: "router-command-failed",
			message: "Fixture command was not defined",
		};
}

async function fixtureDocument(name: string): Promise<FixtureDocument> {
	const path = fileURLToPath(
		new URL(`../../../test/fixtures/router/${name}.json`, import.meta.url),
	);
	return JSON.parse(await readFile(path, "utf8")) as FixtureDocument;
}

async function runnerWithSubagents(payload: unknown): Promise<RouterCommandRunner> {
	const fixture = await fixtureDocument("healthy-proven");
	fixture.subagents = { ok: true, stdout: `${JSON.stringify(payload)}\n`, stderr: "" };
	return async (command) =>
		fixture[command] ?? {
			ok: false,
			code: "router-command-failed",
			message: "Fixture command was not defined",
		};
}

test("does not guess default proven Router agents that status cannot enumerate", async () => {
	const result = await readRouterCapabilities({ runner: await fixtureRunner("healthy-proven") });
	assert.deepEqual(result, {
		installed: true,
		healthy: true,
		version: "0.4.0-beta.4",
		subagentMode: "proven",
		enabledAgents: [],
		disabledAgents: [],
	});
});

test("does not promote stale selection state and reports disabled selection honestly", async () => {
	const result = await readRouterCapabilities({
		runner: await runnerWithSubagents({
			version: 2,
			mode: "selected",
			enabled: ["router_stale_candidate"],
			disabled: ["router_disabled_agent"],
			all: false,
			path: "/synthetic/router/multi-agent-settings.json",
			proofs: {
				router_stale_candidate: {
					status: "failed",
					reason: "synthetic capability failure",
				},
			},
			efforts: {},
			autoPolicies: {
				version: 1,
				policies: [],
				matchingSlugs: [],
				path: "/synthetic/router/subagent-auto-policy.json",
			},
		}),
	});
	assert.deepEqual(result.enabledAgents, []);
	assert.deepEqual(result.disabledAgents, ["router_disabled_agent"]);
});

test("treats an explicit legacy proven record as diagnostic, not registry proof", async () => {
	const result = await readRouterCapabilities({
		runner: await runnerWithSubagents({
			version: 2,
			mode: "proven",
			enabled: ["router_legacy_proven"],
			disabled: [],
			all: false,
			path: "/synthetic/router/multi-agent-settings.json",
			proofs: {
				router_legacy_proven: {
					status: "proven",
					spawn: { ok: true, status: 200, at: "2026-08-22T12:00:00.000Z" },
				},
			},
			efforts: {},
			autoPolicies: {
				version: 1,
				policies: [],
				matchingSlugs: [],
				path: "/synthetic/router/subagent-auto-policy.json",
			},
		}),
	});
	assert.deepEqual(result.enabledAgents, []);
});

test("rejects invalid and unknown proof records instead of treating them as authority", async () => {
	for (const proof of [
		{ status: "definitely-v2" },
		{ status: "proven", registryV2: true },
	]) {
		await assert.rejects(
			readRouterCapabilities({
				runner: await runnerWithSubagents({
					version: 2,
					mode: "selected",
					enabled: ["router_unknown_proof"],
					disabled: [],
					all: false,
					path: "/synthetic/router/multi-agent-settings.json",
					proofs: { router_unknown_proof: proof },
					efforts: {},
					autoPolicies: {
						version: 1,
						policies: [],
						matchingSlugs: [],
						path: "/synthetic/router/subagent-auto-policy.json",
					},
				}),
			}),
			(error: unknown) => (error as { code?: unknown }).code === "incompatible-router",
		);
	}
});

test("accepts the pinned Router activity provider, model, and session fields", async () => {
	const fixture = await fixtureDocument("healthy-proven");
	const status = fixture.status;
	assert.ok(status?.ok);
	const lines = status.stdout.trim().split("\n");
	const health = JSON.parse(lines[2]) as Record<string, unknown>;
	const activityPath = fileURLToPath(
		new URL("../../../test/fixtures/router/health-activity.json", import.meta.url),
	);
	health.activity = JSON.parse(await readFile(activityPath, "utf8")) as unknown;
	lines[2] = JSON.stringify(health);
	fixture.status = { ok: true, stdout: `${lines.join("\n")}\n`, stderr: "" };
	const result = await readRouterCapabilities({
		runner: async (command) => fixture[command] ?? assert.fail(`missing ${command} fixture`),
	});
	assert.equal(result.healthy, true);
});

test("reports a missing executable without conflating it with an unhealthy service", async () => {
	const execute: RouterProcessExecutor = async () => {
		const error = new Error("spawn failed") as NodeJS.ErrnoException;
		error.code = "ENOENT";
		throw error;
	};
	const commandResult = await runRouterCommand("version", { execute });
	assert.deepEqual(commandResult, {
		ok: false,
		code: "missing-router",
		message: "Codex Router is not installed",
	});
	const result = await readRouterCapabilities({ runner: async () => commandResult });
	assert.deepEqual(result, {
		installed: false,
		healthy: false,
		version: null,
		subagentMode: "unavailable",
		enabledAgents: [],
		disabledAgents: [],
	});
});

test("reports an installed but unhealthy Router distinctly", async () => {
	const result = await readRouterCapabilities({ runner: await fixtureRunner("unhealthy") });
	assert.deepEqual(result, {
		installed: true,
		healthy: false,
		version: "0.4.0-beta.4",
		subagentMode: "unavailable",
		enabledAgents: [],
		disabledAgents: [],
	});
});

test("normalizes a healthy Router with only the legacy v1 subagent surface", async () => {
	const result = await readRouterCapabilities({ runner: await fixtureRunner("healthy-v1") });
	assert.deepEqual(result, {
		installed: true,
		healthy: true,
		version: "0.4.0-beta.4",
		subagentMode: "v1-only",
		enabledAgents: [],
		disabledAgents: [],
	});
});

test("malformed output is incompatible, never guessed or reflected", async () => {
	await assert.rejects(
		readRouterCapabilities({ runner: await fixtureRunner("malformed") }),
		(error: unknown) => {
			assert.equal((error as { code?: unknown }).code, "incompatible-router");
			assert.match(String(error), /incompatible-router/);
			assert.doesNotMatch(String(error), /synthetic-secret|provider_key|not-an-array/);
			return true;
		},
	);
});

test("executes only the exact supported command boundaries without a shell", async () => {
	const observed: Array<{ file: string; args: readonly string[]; options: RouterProcessOptions }> = [];
	const execute: RouterProcessExecutor = async (file, args, options) => {
		observed.push({ file, args, options });
		return { stdout: "ok\n", stderr: "" };
	};

	for (const command of Object.keys(ROUTER_COMMANDS) as RouterCommand[]) {
		const result = await runRouterCommand(command, { execute });
		assert.equal(result.ok, true);
	}

	assert.deepEqual(
		observed.map(({ file, args }) => [file, ...args]),
		[
			["codex-router", "version"],
			["codex-router", "status"],
			["codex-router", "doctor", "--json"],
			["codex-router", "control", "subagents", "status"],
		],
	);
	for (const [index, { options }] of observed.entries()) {
		assert.equal(options.timeout, index === 2 ? 65_000 : 15_000);
		assert.equal(options.maxBuffer, 256 * 1024);
		assert.equal("shell" in options, false);
		assert.deepEqual(
			Object.keys(options.env as object).sort(),
			[...(process.env.CODEX_HOME ? ["CODEX_HOME"] : []), "HOME", "LANG", "LC_ALL", "PATH"].sort(),
		);
	}
});

test("gives Router doctor a bounded window for its pinned health and catalog probes", async () => {
	let timeout = 0;
	await runRouterCommand("doctor", { execute: async (_file, _args, options) => {
		timeout = options.timeout;
		return { stdout: '{"ok":true,"checks":[]}\n', stderr: "" };
	} });
	assert.equal(timeout, 65_000);
});

test("preserves only pinned non-secret Router path overrides", async () => {
	const environment: NodeJS.ProcessEnv = {
		PATH: "/workspace/node_modules/.bin:/synthetic/user-bin",
		HOME: "/synthetic/home",
		CODEX_HOME: "/synthetic/codex-home",
		CODEX_ROUTER_SOURCE_ROOT: "/synthetic/router/source",
		CODEX_ROUTER_STATE_DIR: "/synthetic/router/state-codex",
		KIMI_CODEX_STATE_DIR: "/synthetic/router/state-legacy",
		MODEL_ROUTER_STATE_DIR: "/synthetic/router/state",
		MODEL_ROUTER_MULTI_AGENT_STATE: "/synthetic/router/multi-agent.json",
		MODEL_ROUTER_MULTI_AGENT_ALL: "/synthetic/router/multi-agent-legacy.json",
		MODEL_ROUTER_SUBAGENT_PROOFS: "/synthetic/router/proofs.json",
		MODEL_ROUTER_SUBAGENT_AUTO_POLICY: "/synthetic/router/policies.json",
		MODEL_ROUTER_LAUNCH_AGENTS_DIR: "/synthetic/router/launch-agents",
		CODEX_ROUTER_LAUNCH_AGENTS_DIR: "/synthetic/router/launch-agents-codex",
		MODEL_ROUTER_GATEWAY_PORT: "4300",
		CODEX_ROUTER_GATEWAY_PORT: "4301",
		KIMI_GATEWAY_PORT: "4302",
		MODEL_ROUTER_OAUTH_PORT: "4303",
		CODEX_ROUTER_OAUTH_PORT: "4304",
		KIMI_OAUTH_FORWARD_PORT: "4305",
		MODEL_ROUTER_PORT: "4306",
		CODEX_ROUTER_PORT: "4307",
		KIMI_ROUTER_PORT: "4308",
		MODEL_ROUTER_API_PORT: "4309",
		CODEX_ROUTER_API_PORT: "4310",
		KIMI_API_FORWARD_PORT: "4311",
		MODEL_ROUTER_GROK_OAUTH_PORT: "4312",
		MODEL_ROUTER_DEVIN_CLI_PORT: "4313",
		CODEX_ROUTER_HOST: "router.internal.example",
		KIMI_ROUTER_HOST: "::1",
		OPENAI_API_KEY: "synthetic-openai-credential",
		AWS_SECRET_ACCESS_KEY: "synthetic-aws-credential",
		UNRELATED_VALUE: "must-not-pass",
	};
	let observed: NodeJS.ProcessEnv | undefined;
	const execute: RouterProcessExecutor = async (_file, _args, options) => {
		observed = options.env;
		return { stdout: "0.4.0-beta.4\n", stderr: "" };
	};
	await runRouterCommand("version", { execute, environment });
	assert.deepEqual(observed, {
		LANG: "C",
		LC_ALL: "C",
		PATH: await expectedRouterPath(),
		HOME: "/synthetic/home",
		CODEX_HOME: "/synthetic/codex-home",
		CODEX_ROUTER_STATE_DIR: "/synthetic/router/state-codex",
		KIMI_CODEX_STATE_DIR: "/synthetic/router/state-legacy",
		MODEL_ROUTER_STATE_DIR: "/synthetic/router/state",
		MODEL_ROUTER_MULTI_AGENT_STATE: "/synthetic/router/multi-agent.json",
		MODEL_ROUTER_MULTI_AGENT_ALL: "/synthetic/router/multi-agent-legacy.json",
		MODEL_ROUTER_SUBAGENT_PROOFS: "/synthetic/router/proofs.json",
		MODEL_ROUTER_SUBAGENT_AUTO_POLICY: "/synthetic/router/policies.json",
		MODEL_ROUTER_LAUNCH_AGENTS_DIR: "/synthetic/router/launch-agents",
		CODEX_ROUTER_LAUNCH_AGENTS_DIR: "/synthetic/router/launch-agents-codex",
		MODEL_ROUTER_GATEWAY_PORT: "4300",
		CODEX_ROUTER_GATEWAY_PORT: "4301",
		KIMI_GATEWAY_PORT: "4302",
		MODEL_ROUTER_OAUTH_PORT: "4303",
		CODEX_ROUTER_OAUTH_PORT: "4304",
		KIMI_OAUTH_FORWARD_PORT: "4305",
		MODEL_ROUTER_PORT: "4306",
		CODEX_ROUTER_PORT: "4307",
		KIMI_ROUTER_PORT: "4308",
		MODEL_ROUTER_API_PORT: "4309",
		CODEX_ROUTER_API_PORT: "4310",
		KIMI_API_FORWARD_PORT: "4311",
		MODEL_ROUTER_GROK_OAUTH_PORT: "4312",
		MODEL_ROUTER_DEVIN_CLI_PORT: "4313",
		CODEX_ROUTER_HOST: "router.internal.example",
		KIMI_ROUTER_HOST: "::1",
	});
});

test("omits invalid host and port selectors instead of forwarding arbitrary values", async () => {
	let observed: NodeJS.ProcessEnv | undefined;
	const execute: RouterProcessExecutor = async (_file, _args, options) => {
		observed = options.env;
		return { stdout: "0.4.0-beta.4\n", stderr: "" };
	};
	await runRouterCommand("version", {
		execute,
		environment: {
			MODEL_ROUTER_PORT: "0",
			CODEX_ROUTER_PORT: "65536",
			KIMI_ROUTER_PORT: "12.5",
			MODEL_ROUTER_API_PORT: "not-a-port",
			CODEX_ROUTER_HOST: "https://router.example/path",
			KIMI_ROUTER_HOST: `host-${"x".repeat(260)}`,
		},
	});
	assert.deepEqual(observed, {
		LANG: "C",
		LC_ALL: "C",
		PATH: await expectedRouterPath(),
	});
});

test("adds only the canonical directory of the already-running Node executable to PATH", async () => {
	let observed: NodeJS.ProcessEnv | undefined;
	const execute: RouterProcessExecutor = async (_file, _args, options) => {
		observed = options.env;
		return { stdout: "0.4.0-beta.4\n", stderr: "" };
	};
	await runRouterCommand("version", {
		execute,
		environment: {
			PATH: "/workspace/node_modules/.bin:/synthetic/user-bin",
			OPENAI_API_KEY: "synthetic-openai-credential",
		},
	});
	assert.equal(observed?.PATH, await expectedRouterPath());
	assert.doesNotMatch(observed?.PATH ?? "", /workspace|synthetic|node_modules/);
});

test("canonicalizes an explicit Homebrew-style Router symlink to one safe executable target", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "omcs-router-executable-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const target = join(root, "Cellar", "codex-router", "0.4.0", "bin", "codex-router");
	await mkdir(join(root, "Cellar", "codex-router", "0.4.0", "bin"), { recursive: true });
	await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o755, flag: "wx" });
	await chmod(target, 0o755);
	await access(target, constants.X_OK);
	const bin = join(root, "bin");
	await mkdir(bin);
	const requested = join(bin, "codex-router");
	await symlink("../Cellar/codex-router/0.4.0/bin/codex-router", requested);
	let executedFile: string | undefined;
	let executedEnvironment: NodeJS.ProcessEnv | undefined;
	const execute: RouterProcessExecutor = async (file, _args, options) => {
		executedFile = file;
		executedEnvironment = options.env;
		return { stdout: "0.4.0-beta.4\n", stderr: "" };
	};
	const result = await runRouterCommand("version", { execute, routerExecutable: requested });
	assert.equal(result.ok, true);
	assert.equal(executedFile, await realpath(target));
	assert.equal(executedEnvironment?.PATH, await expectedRouterPath());
});

test("rejects relative, nonfile, broken-link, and hard-linked explicit Router executables", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "omcs-router-unsafe-executable-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const executable = join(root, "codex-router");
	await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755, flag: "wx" });
	const hardlink = join(root, "codex-router-hardlink");
	await link(executable, hardlink);
	const broken = join(root, "codex-router-broken");
	await symlink("missing-target", broken);
	let executions = 0;
	const execute: RouterProcessExecutor = async () => {
		executions += 1;
		return { stdout: "unexpected", stderr: "" };
	};
	for (const routerExecutable of ["codex-router", root, broken, executable, hardlink]) {
		assert.deepEqual(await runRouterCommand("version", { execute, routerExecutable }), {
			ok: false,
			code: "router-command-failed",
			message: "Explicit Codex Router executable is unsafe or unavailable",
		});
	}
	assert.equal(executions, 0);
});

test("classifies a command timeout without exposing process diagnostics", async () => {
	const execute: RouterProcessExecutor = async () => {
		const error = new Error("timed out with --api-key synthetic-timeout-secret") as NodeJS.ErrnoException;
		error.code = "ETIMEDOUT";
		throw error;
	};
	const result = await runRouterCommand("status", { execute });
	assert.deepEqual(result, {
		ok: false,
		code: "router-timeout",
		message: "Codex Router command timed out after 15000ms",
	});
	await assert.rejects(readRouterCapabilities({ runner: async () => result }), (error: unknown) => {
		assert.equal((error as { code?: unknown }).code, "router-timeout");
		assert.doesNotMatch(String(error), /synthetic-timeout|api-key/);
		return true;
	});
});

test("classifies a rejected supported boundary as an incompatible Router version", async () => {
	const execute: RouterProcessExecutor = async () => {
		const error = new Error("unknown option with provider_key=synthetic-unsupported-secret") as NodeJS.ErrnoException & {
			stderr: string;
		};
		error.code = "2";
		error.stderr = "unknown option --json with provider_key=synthetic-unsupported-secret";
		throw error;
	};
	const commandResult = await runRouterCommand("status", { execute });
	assert.deepEqual(commandResult, {
		ok: false,
		code: "unsupported-router-command",
		message: "Installed Codex Router does not support this command boundary",
	});

	const runner: RouterCommandRunner = async (command) =>
		command === "version"
			? { ok: true, stdout: "0.4.0-beta.4\n", stderr: "" }
			: commandResult;
	await assert.rejects(readRouterCapabilities({ runner }), (error: unknown) => {
		assert.equal((error as { code?: unknown }).code, "incompatible-router");
		assert.doesNotMatch(String(error), /synthetic-unsupported|provider_key|--json/);
		return true;
	});
});

test("redacts credential patterns from bounded command errors", async () => {
	const execute: RouterProcessExecutor = async () => {
		const error = new Error("failed") as NodeJS.ErrnoException & { stderr: string };
		error.code = "EFAIL";
		error.stderr = [
			"Authorization: Bearer synthetic-bearer-secret",
			"provider_key=synthetic-provider-secret",
			"token=synthetic-token-secret",
			"CLIENT_SECRET=synthetic-client-secret",
			"AWS_SECRET_ACCESS_KEY=synthetic-aws-secret",
			'{"aws_session_token":"synthetic-aws-session"}',
			'{"apiKey":"synthetic-json-secret"}',
			"--api-key synthetic-argv-secret",
			"-----BEGIN PRIVATE KEY-----",
			"synthetic-private-material-without-an-end-marker",
		].join("\n");
		throw error;
	};
	const result = await runRouterCommand("doctor", { execute });
	assert.equal(result.ok, false);
	assert.equal(result.code, "router-command-failed");
	assert.match(result.message, /\[REDACTED\]/);
	assert.doesNotMatch(
		result.message,
		/synthetic-[a-z-]+-(?:secret|material|session)|Bearer\s+\S+|provider_key=|token=|apiKey|client_secret|aws_secret|--api-key|PRIVATE KEY/i,
	);
});

test("redacts credential patterns from successful command output before returning it", async () => {
	const execute: RouterProcessExecutor = async () => ({
		stdout: '{"provider_key":"synthetic-success-secret","client-secret":"synthetic-client-value","AWS_SESSION_TOKEN":"synthetic-session-value"}\n',
		stderr: "Authorization: Bearer synthetic-success-bearer\nAWS_SECRET_ACCESS_KEY=synthetic-aws-value",
	});
	const result = await runRouterCommand("status", { execute });
	assert.equal(result.ok, true);
	assert.match(result.stdout, /\[REDACTED\]/);
	assert.match(result.stderr, /\[REDACTED\]/);
	assert.doesNotMatch(
		`${result.stdout}\n${result.stderr}`,
		/synthetic-(?:success|client|session|aws)|provider_key|client-secret|AWS_SESSION_TOKEN|Authorization|AWS_SECRET_ACCESS_KEY/,
	);
});

test("bounds successful stdout and stderr returned by the process boundary", async () => {
	const execute: RouterProcessExecutor = async () => ({
		stdout: "x".repeat(300 * 1024),
		stderr: "y".repeat(300 * 1024),
	});
	const result = await runRouterCommand("version", { execute });
	assert.equal(result.ok, true);
	assert.equal(result.stdout.length, 256 * 1024);
	assert.equal(result.stderr.length, 256 * 1024);
});
