import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { summarizeExecutedBenchmark } from "../benchmark.js";
import { parseBenchmarkResults } from "../../benchmark/report.js";

const cli = join(process.cwd(), "dist", "cli", "omcs.js");

async function fixture(): Promise<{
	root: string;
	suitePath: string;
	resultsPath: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "omcs-benchmark-cli-"));
	await mkdir(join(root, "fixtures", "task"), { recursive: true });
	await writeFile(join(root, "fixtures", "task", "README.md"), "fixture\n");
	await writeFile(join(root, "grader.mjs"), "process.exit(0);\n");
	const suitePath = join(root, "suite.json");
	await writeFile(
		suitePath,
		JSON.stringify({
			schemaVersion: 1,
			name: "cli-pilot",
			model: "synthetic-model",
			reasoningEffort: "low",
			sandbox: "workspace-write",
			timeoutSeconds: 60,
			repetitions: 1,
			seed: "cli-pilot",
			conditions: [
				{ id: "plain", kind: "codex-default" },
				{ id: "auto", kind: "omcs", profile: "auto" },
			],
			tasks: [
				{
					id: "task",
					title: "Task",
					category: "docs",
					fixture: "fixtures/task",
					prompt: "Write the answer SECRET-PROMPT-CONTENT.",
					grader: ["node", "grader.mjs"],
					graderAssets: ["grader.mjs"],
				},
			],
		}),
	);
	const resultsPath = join(root, "results.json");
	const provenance = {
		suiteSha256: "0".repeat(64),
		codexCliVersion: "synthetic",
		omcsPackageVersion: "0.1.0",
		omcsPluginSha256: "0".repeat(64),
		omcsRuntimeSha256: "0".repeat(64),
		benchmarkHarnessSha256: "0".repeat(64),
		nodeRuntimeSha256: "0".repeat(64),
		nodeVersion: "v22.0.0",
		graderImage: "synthetic",
		tasks: {
			task: {
				fixtureSha256: "0".repeat(64),
				graderSha256: "0".repeat(64),
				promptSha256: "0".repeat(64),
			},
		},
	};
	const expectedRuns = [
		{ runId: "p", taskId: "task", conditionId: "plain", repetition: 1 },
		{ runId: "a", taskId: "task", conditionId: "auto", repetition: 1 },
	];
	const plan = {
		schemaVersion: 1,
		suite: "cli-pilot",
		controls: {
			model: "synthetic-model",
			reasoningEffort: "low",
			sandbox: "workspace-write",
			timeoutSeconds: 60,
			seed: "synthetic-seed",
		},
		provenance,
		runs: expectedRuns,
	};
	await writeFile(
		resultsPath,
		JSON.stringify({
			suite: "cli-pilot",
			conditions: ["plain", "auto"],
			baselineConditionId: "plain",
			treatmentConditionId: "auto",
			provenance,
			planSha256: createHash("sha256")
				.update(JSON.stringify(plan))
				.digest("hex"),
			plan,
			expectedRuns,
			runs: [
				{
					runId: "p",
					taskId: "task",
					conditionId: "plain",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: false,
					usageObserved: false,
					verified: false,
					durationMs: 10,
					safetyViolations: 0,
				},
				{
					runId: "a",
					taskId: "task",
					conditionId: "auto",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: false,
					usageObserved: false,
					verified: true,
					durationMs: 12,
					safetyViolations: 0,
				},
			],
		}),
	);
	return { root, suitePath, resultsPath };
}

describe("benchmark CLI", () => {
	it("plans and dry-runs a comparison without exposing prompts or invoking models", async () => {
		const item = await fixture();
		try {
			const planned = spawnSync(
				process.execPath,
				[cli, "benchmark", "plan", item.suitePath, "--json"],
				{ encoding: "utf8" },
			);
			assert.equal(planned.status, 0, planned.stderr);
			assert.equal(JSON.parse(planned.stdout).runs.length, 2);
			assert.doesNotMatch(planned.stdout, /SECRET-PROMPT-CONTENT/);

			const dryRun = spawnSync(
				process.execPath,
				[cli, "benchmark", "run", item.suitePath, "--dry-run", "--json"],
				{ encoding: "utf8" },
			);
			assert.equal(dryRun.status, 0, dryRun.stderr);
			assert.equal(JSON.parse(dryRun.stdout).modelExecution, false);
			assert.doesNotMatch(dryRun.stdout, /SECRET-PROMPT-CONTENT/);
		} finally {
			await rm(item.root, { recursive: true, force: true });
		}
	});

	it("summarizes saved paired results", async () => {
		const item = await fixture();
		try {
			const result = spawnSync(
				process.execPath,
				[cli, "benchmark", "report", item.resultsPath, "--json"],
				{ encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(JSON.parse(result.stdout).paired.verifiedRateDelta, 1);
		} finally {
			await rm(item.root, { recursive: true, force: true });
		}
	});

	it("summarizes a completed execution without feeding its private result path into strict result parsing", async () => {
		const item = await fixture();
		try {
			const completed = summarizeExecutedBenchmark({
				...parseBenchmarkResults(JSON.parse(await readFile(item.resultsPath, "utf8")) as unknown),
				resultPath: item.resultsPath,
			});
			assert.equal(completed.modelExecution, true);
			assert.equal(completed.resultPath, item.resultsPath);
			assert.equal(completed.report.paired.verifiedRateDelta, 1);
		} finally {
			await rm(item.root, { recursive: true, force: true });
		}
	});

	for (const args of [
		["benchmark", "run", "suite.json", "--json"],
		["benchmark", "run", "suite.json", "--execute", "--json"],
		[
			"benchmark",
			"run",
			"suite.json",
			"--dry-run",
			"--execute",
			"--approve-model-usage",
		],
		["benchmark", "plan", "suite.json", "--execute"],
	]) {
		it(`rejects unsafe or ambiguous invocation: ${args.join(" ")}`, () => {
			const result = spawnSync(process.execPath, [cli, ...args], {
				encoding: "utf8",
			});
			assert.equal(result.status, 64);
			assert.match(result.stderr, /^omcs: invalid arguments/);
		});
	}
});
