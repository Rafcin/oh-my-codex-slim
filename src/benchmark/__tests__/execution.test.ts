import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
	assertModelToolPathIsPinned,
	benchmarkModelEnvironment,
	buildPinnedMcpManifest,
	codexRunDisposition,
	executeBenchmark,
	runProcess,
} from "../execution.js";
import { parseBenchmarkSuite } from "../manifest.js";

describe("isolated benchmark execution", () => {
	it("replaces the caller PATH with the private benchmark tool boundary", () => {
		const environment = benchmarkModelEnvironment("/private/benchmark-tools");
		assert.equal(
			environment.PATH,
			process.platform === "win32"
				? `/private/benchmark-tools;${process.env.SystemRoot}\\System32`
				: "/private/benchmark-tools:/usr/bin:/bin",
		);
		assert.equal(environment.PATH?.includes(".nvm"), false);
	});

	it("fails closed when any OMCS command is visible on the model PATH", async () => {
		const tools = await mkdtemp(join(tmpdir(), "omcs-benchmark-tools-test-"));
		try {
			await writeFile(join(tools, "node"), "#!/bin/sh\nexit 0\n");
			await writeFile(join(tools, "omcs"), "#!/bin/sh\nexit 0\n");
			await chmod(join(tools, "node"), 0o700);
			await chmod(join(tools, "omcs"), 0o700);
			await assert.rejects(
				() => assertModelToolPathIsPinned(tools),
				/no OMCS command/,
			);
		} finally {
			await rm(tools, { recursive: true, force: true });
		}
	});

	it("records timeouts as failed outcomes while aborting infrastructure exits", () => {
		assert.equal(
			codexRunDisposition({ status: 143, timedOut: true }),
			"record-timeout",
		);
		assert.equal(codexRunDisposition({ status: 1, timedOut: false }), "abort");
		assert.equal(codexRunDisposition({ status: 0, timedOut: false }), "complete");
	});

	it("terminates same-group descendants after a successful leader exit", async (context) => {
		if (process.platform === "win32")
			return context.skip("process-group signaling is Unix-specific");
		const result = await runProcess(
			process.execPath,
			[
				"-e",
				`const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
child.unref();
process.stdout.write(String(child.pid));`,
			],
			{
				cwd: process.cwd(),
				timeoutMs: 10_000,
				environment: process.env,
			},
		);
		assert.equal(result.status, 0);
		const descendantPid = Number.parseInt(result.stdout, 10);
		assert.equal(Number.isInteger(descendantPid), true);
		assert.throws(() => process.kill(descendantPid, 0));
	});

	it("streams final usage even when the retained transcript is truncated", async () => {
		const result = await runProcess(
			process.execPath,
			[
				"-e",
				`process.stdout.write("x".repeat(9 * 1024 * 1024) + "\\n");
process.stdout.write(JSON.stringify({ usage: { input_tokens: 321, output_tokens: 45 } }) + "\\n");`,
			],
			{
				cwd: process.cwd(),
				timeoutMs: 10_000,
				environment: process.env,
			},
		);
		assert.equal(result.status, 0);
		assert.equal(result.stdoutTruncated, true);
		assert.equal(result.inputTokens, 321);
		assert.equal(result.outputTokens, 45);
	});

	it("pins the MCP server to this checkout without a PATH-level OMCS command", () => {
		const manifest = buildPinnedMcpManifest("/private/omcs-checkout");
		assert.deepEqual(manifest.mcpServers.omcs_code_intel, {
			command: process.execPath,
			args: [
				"/private/omcs-checkout/dist/cli/omcs.js",
				"mcp-serve",
				"code-intel",
			],
			enabled: true,
		});
		assert.notEqual(manifest.mcpServers.omcs_code_intel.command, "omcs");
	});

	it("launches the pinned MCP in the benchmark workspace and can inspect it", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "omcs-benchmark-mcp-"));
		await writeFile(join(workspace, "example.js"), "export const value = 1;\n");
		const pinned = buildPinnedMcpManifest(process.cwd()).mcpServers
			.omcs_code_intel;
		const transport = new StdioClientTransport({
			command: pinned.command,
			args: pinned.args,
			cwd: workspace,
			env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
			stderr: "pipe",
		});
		const client = new Client({ name: "omcs-benchmark-test", version: "1.0.0" });
		try {
			await client.connect(transport);
			const response = await client.callTool({
				name: "omcs_codemap",
				arguments: { root: workspace, maxFiles: 10 },
			});
			const content = response.content as Array<{ type?: unknown; text?: unknown }>;
			const text = content.find((item) => item.type === "text")?.text;
			assert.equal(typeof text, "string");
			const result = JSON.parse(text as string) as {
				ok?: unknown;
				data?: { files?: Array<{ path?: unknown }> };
			};
			assert.equal(result.ok, true);
			assert.deepEqual(result.data?.files?.map((file) => file.path), ["example.js"]);
		} finally {
			await client.close();
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("runs pair-complete fixtures through a fake Codex boundary and hidden grader", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-benchmark-test-"));
		try {
			await mkdir(join(root, "fixtures", "task"), { recursive: true });
			await mkdir(join(root, "graders"), { recursive: true });
			await writeFile(join(root, "fixtures", "task", "value.txt"), "before\n", {
				mode: 0o600,
			});
			const fakeCodex = join(root, "fake-codex.mjs");
			await writeFile(
				fakeCodex,
				`
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const workspace = args[args.indexOf("--cd") + 1];
for await (const _chunk of process.stdin) { /* consume prompt stdin */ }
await writeFile(new URL("value.txt", "file://" + workspace + "/"), "after\\n");
process.stdout.write(JSON.stringify({ type: "usage", input_tokens: 10, output_tokens: 5 }) + "\\n");
`,
			);
			await chmod(fakeCodex, 0o700);
			await writeFile(join(root, "node"), "#!/bin/sh\nexit 0\n");
			await chmod(join(root, "node"), 0o700);
			const fakeContainer = join(root, "fake-container.mjs");
			await writeFile(
				fakeContainer,
				`
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const volumes = args.flatMap((arg, index) => arg === "--volume" ? [args[index + 1]] : []).filter(Boolean);
const suite = volumes.find((value) => value.includes(":/suite:ro")).split(":/suite:ro")[0];
const workspace = volumes.find((value) => value.includes(":/workspace:ro")).split(":/workspace:ro")[0];
const imageIndex = args.findIndex((value) => value.startsWith("node@sha256:"));
const command = args.slice(imageIndex + 1);
const result = spawnSync(process.execPath, command.slice(1), {
  cwd: suite,
  env: { PATH: process.env.PATH, OMCS_BENCH_WORKSPACE: workspace },
  encoding: "utf8"
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`,
			);
			await writeFile(
				join(root, "graders", "task.mjs"),
				`
import { readFile } from "node:fs/promises";
const value = await readFile(new URL("value.txt", "file://" + process.env.OMCS_BENCH_WORKSPACE + "/"), "utf8");
process.stdout.write(JSON.stringify({ verified: value === "after\\n", safetyViolations: 0 }));
`,
			);

			const suite = parseBenchmarkSuite({
				schemaVersion: 1,
				name: "execution-test",
				model: "synthetic-model",
				reasoningEffort: "low",
				sandbox: "workspace-write",
				timeoutSeconds: 60,
				repetitions: 1,
				seed: "execution-test",
				conditions: [
					{ id: "plain", kind: "codex-default" },
					{ id: "auto", kind: "omcs", profile: "auto" },
				],
				tasks: [
					{
						id: "task",
						title: "Task",
						category: "bugfix",
						fixture: "fixtures/task",
						prompt: "Change the value.",
						grader: ["node", "graders/task.mjs"],
						graderAssets: ["graders/task.mjs"],
					},
				],
			});
			const outputRoot = join(root, "private-results");
			const result = await executeBenchmark({
				suite,
				suiteRoot: root,
				outputRoot,
				approval: { execute: true, approveModelUsage: true },
				codexExecutable: process.execPath,
				codexArgsPrefix: [fakeCodex],
				preparedCodexHome: root,
				preparedToolDirectory: root,
				codexCliVersion: "codex-cli synthetic",
				containerExecutable: process.execPath,
				containerArgsPrefix: [fakeContainer],
			});

			assert.equal(result.runs.length, 2);
			const runRoot = join(result.resultPath, "..");
			const diagnosticErrors = await Promise.all(
				(await readdir(runRoot))
					.filter((name) => name.endsWith(".stderr.txt"))
					.map((name) => readFile(join(runRoot, name), "utf8")),
			);
			assert.ok(
				result.runs.every((run) => run.verified),
				JSON.stringify(diagnosticErrors),
			);
			assert.ok(
				result.runs.every(
					(run) => run.inputTokens === 10 && run.outputTokens === 5,
				),
			);
			assert.equal((await stat(result.resultPath)).mode & 0o077, 0);
			assert.doesNotMatch(
				await readFile(result.resultPath, "utf8"),
				/Change the value/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses fixture paths that escape the suite root", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-benchmark-path-test-"));
		try {
			const suite = parseBenchmarkSuite({
				schemaVersion: 1,
				name: "escape-test",
				model: "synthetic-model",
				reasoningEffort: "low",
				sandbox: "workspace-write",
				timeoutSeconds: 60,
				repetitions: 1,
				seed: "escape-test",
				conditions: [
					{ id: "plain", kind: "codex-default" },
					{ id: "auto", kind: "omcs", profile: "auto" },
				],
				tasks: [
					{
						id: "task",
						title: "Task",
						category: "bugfix",
						fixture: "../outside",
						prompt: "Work.",
						grader: ["node", "grader.mjs"],
						graderAssets: ["grader.mjs"],
					},
				],
			});
			await assert.rejects(
				() =>
					executeBenchmark({
						suite,
						suiteRoot: root,
						outputRoot: join(root, "results"),
						approval: { execute: true, approveModelUsage: true },
						preparedCodexHome: root,
						codexCliVersion: "codex-cli synthetic",
					}),
				/fixture must stay inside the suite root/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
