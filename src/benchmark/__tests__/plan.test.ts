import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planBenchmark } from "../plan.js";
import { parseBenchmarkSuite } from "../manifest.js";

const digest = "0".repeat(64);
const provenance = {
	suiteSha256: digest,
	codexCliVersion: "codex-cli synthetic",
	omcsPackageVersion: "0.1.0",
	omcsPluginSha256: digest,
	omcsRuntimeSha256: digest,
	benchmarkHarnessSha256: digest,
	nodeRuntimeSha256: digest,
	nodeVersion: "v22.0.0",
	graderImage: "node@sha256:synthetic",
	tasks: {
		one: { fixtureSha256: digest, graderSha256: digest, promptSha256: digest },
		two: { fixtureSha256: digest, graderSha256: digest, promptSha256: digest },
	},
};

const suite = parseBenchmarkSuite({
	schemaVersion: 1,
	name: "paired",
	model: "gpt-5.6-terra",
	reasoningEffort: "high",
	sandbox: "workspace-write",
	timeoutSeconds: 600,
	repetitions: 2,
	seed: "stable-seed",
	conditions: [
		{ id: "plain", kind: "codex-default" },
		{ id: "auto", kind: "omcs", profile: "auto" },
	],
	tasks: [
		{
			id: "one",
			title: "One",
			category: "bugfix",
			fixture: "../fixtures/one",
			prompt: "Do one",
			grader: ["node", "grader-one.mjs"],
			graderAssets: ["grader-one.mjs"],
		},
		{
			id: "two",
			title: "Two",
			category: "feature",
			fixture: "../fixtures/two",
			prompt: "Do two",
			grader: ["node", "grader-two.mjs"],
			graderAssets: ["grader-two.mjs"],
		},
	],
});

describe("benchmark planning", () => {
	it("creates a deterministic, pair-complete randomized matrix", () => {
		const first = planBenchmark(suite, provenance);
		const second = planBenchmark(suite, provenance);
		assert.deepEqual(first, second);
		assert.equal(first.runs.length, 8);
		assert.equal(new Set(first.runs.map((run) => run.runId)).size, 8);

		for (const taskId of ["one", "two"]) {
			for (const repetition of [1, 2]) {
				assert.deepEqual(
					first.runs
						.filter(
							(run) => run.taskId === taskId && run.repetition === repetition,
						)
						.map((run) => run.conditionId)
						.sort(),
					["auto", "plain"],
				);
			}
		}
	});

	it("records the frozen controls without embedding task prompts", () => {
		const plan = planBenchmark(suite, provenance);
		assert.deepEqual(plan.controls, {
			model: "gpt-5.6-terra",
			reasoningEffort: "high",
			sandbox: "workspace-write",
			timeoutSeconds: 600,
			seed: "stable-seed",
		});
		assert.doesNotMatch(JSON.stringify(plan), /Do one|Do two/);
	});
});
