import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { assertExecutionApproved, buildCodexInvocation } from "../runner.js";

describe("benchmark runner safety and parity", () => {
	it("makes the baseline ignore user instructions, rules, plugins, and hooks", () => {
		const invocation = buildCodexInvocation({
			kind: "codex-default",
			model: "gpt-5.6-terra",
			reasoningEffort: "high",
			sandbox: "workspace-write",
			workingDirectory: "/private/fixture",
			toolDirectory: "/private/tools",
			prompt: "Repair the issue.",
		});

		const execIndex = invocation.args.indexOf("exec");
		assert.deepEqual(invocation.args.slice(execIndex, execIndex + 9), [
			"exec",
			"--json",
			"--ephemeral",
			"--ignore-user-config",
			"--ignore-rules",
			"--disable",
			"plugins",
			"--disable",
			"hooks",
		]);
		assert.deepEqual(invocation.args.slice(0, 2), ["--ask-for-approval", "never"]);
		assert.ok(invocation.args.includes('default_permissions="omcs-benchmark"'));
		assert.ok(
			invocation.args.includes(
				'permissions.omcs-benchmark.filesystem={":minimal"="read",":project_roots"="write","/private/tools"="read"}',
			),
		);
		assert.equal(invocation.stdin, "Repair the issue.");
	});

	it("uses a Codex CLI argument order accepted without starting a model", (context) => {
		const availability = spawnSync("codex", ["--version"], { encoding: "utf8" });
		if (availability.status !== 0) return context.skip("Codex CLI is unavailable");
		const invocation = buildCodexInvocation({
			kind: "codex-default",
			model: "synthetic-model",
			reasoningEffort: "low",
			sandbox: "workspace-write",
			workingDirectory: process.cwd(),
			toolDirectory: process.cwd(),
			prompt: "Never sent.",
		});
		const parsed = spawnSync("codex", [...invocation.args.slice(0, -1), "--help"], {
			encoding: "utf8",
		});
		assert.equal(parsed.status, 0, parsed.stderr);
		assert.match(parsed.stdout, /Usage: codex exec/);
	});

	it("holds model, reasoning, sandbox, and native tools constant for OMCS", () => {
		const invocation = buildCodexInvocation({
			kind: "omcs",
			profile: "auto",
			model: "gpt-5.6-terra",
			reasoningEffort: "high",
			sandbox: "workspace-write",
			workingDirectory: "/private/fixture",
			toolDirectory: "/private/tools",
			prompt: "Repair the issue.",
		});

		assert.ok(invocation.args.includes("gpt-5.6-terra"));
		assert.ok(invocation.args.includes('model_reasoning_effort="high"'));
		assert.ok(
			invocation.args.some((argument) => argument.includes('":project_roots"="write"')),
		);
		assert.match(invocation.stdin, /^Use OMCS with the auto profile\./);
		assert.match(invocation.stdin, /Repair the issue\.$/);
		assert.equal(
			invocation.args.some((argument) => argument.includes("sol-advisor")),
			false,
		);
		assert.equal(
			invocation.args.some((argument) => argument.includes("context7")),
			false,
		);
	});

	it("fails closed unless a billed execution is specifically acknowledged", () => {
		assert.throws(
			() =>
				assertExecutionApproved({ execute: false, approveModelUsage: true }),
			/requires --execute/,
		);
		assert.throws(
			() =>
				assertExecutionApproved({ execute: true, approveModelUsage: false }),
			/requires --approve-model-usage/,
		);
		assert.doesNotThrow(() =>
			assertExecutionApproved({ execute: true, approveModelUsage: true }),
		);
	});
});
