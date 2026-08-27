import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseBenchmarkSuite } from "../manifest.js";
import { planBenchmark } from "../plan.js";

const benchmarkRoot = join(process.cwd(), "bench");

function run(
	command: string,
	args: string[],
	cwd: string,
	environment = process.env,
) {
	return spawnSync(command, args, { cwd, env: environment, encoding: "utf8" });
}

async function grade(
	task: ReturnType<typeof parseBenchmarkSuite>["tasks"][number],
	workspace: string,
) {
	const [command, ...args] = task.grader;
	const result = run(command!, args, benchmarkRoot, {
		...process.env,
		OMCS_BENCH_WORKSPACE: workspace,
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout) as {
		verified: boolean;
		safetyViolations: number;
	};
}

describe("checked-in prompt-refinement pilot", () => {
	it("has six pair-complete tasks and a 36-run default matrix", async () => {
		const suite = parseBenchmarkSuite(
			JSON.parse(
				await readFile(
					join(benchmarkRoot, "prompt-refinement-pilot.json"),
					"utf8",
				),
			),
		);
		assert.equal(suite.tasks.length, 6);
		const digest = "0".repeat(64);
		assert.equal(
			planBenchmark(suite, {
				suiteSha256: digest,
				codexCliVersion: "synthetic",
				omcsPackageVersion: "0.1.0",
				omcsPluginSha256: digest,
				omcsRuntimeSha256: digest,
				benchmarkHarnessSha256: digest,
				nodeRuntimeSha256: digest,
				nodeVersion: "v22.0.0",
				graderImage: "synthetic",
				tasks: Object.fromEntries(
					suite.tasks.map((task) => [task.id, {
						fixtureSha256: digest,
						graderSha256: digest,
						promptSha256: digest,
					}]),
				),
			}).runs.length,
			36,
		);
	});

	it("proves every baseline fails and every oracle passes its hidden grader", async () => {
		const suite = parseBenchmarkSuite(
			JSON.parse(
				await readFile(
					join(benchmarkRoot, "prompt-refinement-pilot.json"),
					"utf8",
				),
			),
		);
		for (const task of suite.tasks) {
			const parent = await mkdtemp(join(tmpdir(), `omcs-pilot-${task.id}-`));
			const workspace = join(parent, "repo");
			try {
				await cp(join(benchmarkRoot, task.fixture), workspace, {
					recursive: true,
				});
				assert.equal(run("git", ["init", "--quiet"], workspace).status, 0);
				assert.equal(run("git", ["add", "--all"], workspace).status, 0);
				assert.equal(
					run(
						"git",
						[
							"-c",
							"user.name=OMCS Benchmark",
							"-c",
							"user.email=benchmark@example.invalid",
							"commit",
							"--quiet",
							"-m",
							"fixture",
						],
						workspace,
					).status,
					0,
				);
				assert.deepEqual(
					await grade(task, workspace),
					{ verified: false, safetyViolations: 0 },
					`${task.id} baseline should fail`,
				);
				await cp(join(benchmarkRoot, "oracles", task.id), workspace, {
					recursive: true,
					force: true,
				});
				assert.deepEqual(
					await grade(task, workspace),
					{ verified: true, safetyViolations: 0 },
					`${task.id} oracle should pass`,
				);
			} finally {
				await rm(parent, { recursive: true, force: true });
			}
		}
	});
});
