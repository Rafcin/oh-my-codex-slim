import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { summarizeBenchmark } from "../report.js";

const digest = "0".repeat(64);
const provenance = {
	suiteSha256: digest,
	codexCliVersion: "synthetic",
	omcsPackageVersion: "0.1.0",
	omcsPluginSha256: digest,
	omcsRuntimeSha256: digest,
	benchmarkHarnessSha256: digest,
	nodeRuntimeSha256: digest,
	nodeVersion: "v22.0.0",
	graderImage: "synthetic",
	tasks: {
		one: { fixtureSha256: digest, graderSha256: digest, promptSha256: digest },
		two: { fixtureSha256: digest, graderSha256: digest, promptSha256: digest },
	},
};
const expectedRuns = [
	{ runId: "1-p", taskId: "one", conditionId: "plain", repetition: 1 },
	{ runId: "1-a", taskId: "one", conditionId: "auto", repetition: 1 },
	{ runId: "2-p", taskId: "two", conditionId: "plain", repetition: 1 },
	{ runId: "2-a", taskId: "two", conditionId: "auto", repetition: 1 },
];
function planFields(suite: string, runs: typeof expectedRuns) {
	const plan = {
		schemaVersion: 1 as const,
		suite,
		controls: {
			model: "synthetic-model",
			reasoningEffort: "low" as const,
			sandbox: "workspace-write" as const,
			timeoutSeconds: 60,
			seed: "synthetic-seed",
		},
		provenance,
		runs,
	};
	return {
		planSha256: createHash("sha256")
			.update(JSON.stringify(plan))
			.digest("hex"),
		plan,
		expectedRuns: runs,
	};
}

describe("benchmark reporting", () => {
	it("computes paired verified success, efficiency, and safety without a vanity score", () => {
		const report = summarizeBenchmark({
			suite: "pilot",
			conditions: ["plain", "auto"],
			baselineConditionId: "plain",
			treatmentConditionId: "auto",
			provenance,
			...planFields("pilot", expectedRuns),
			runs: [
				{
					runId: "1-p",
					taskId: "one",
					conditionId: "plain",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: true,
					usageObserved: true,
					verified: false,
					durationMs: 100,
					inputTokens: 1000,
					outputTokens: 200,
					safetyViolations: 0,
				},
				{
					runId: "1-a",
					taskId: "one",
					conditionId: "auto",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: false,
					usageObserved: true,
					verified: true,
					durationMs: 130,
					inputTokens: 1200,
					outputTokens: 250,
					safetyViolations: 0,
				},
				{
					runId: "2-p",
					taskId: "two",
					conditionId: "plain",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: false,
					usageObserved: true,
					verified: true,
					durationMs: 200,
					inputTokens: 1400,
					outputTokens: 300,
					safetyViolations: 0,
				},
				{
					runId: "2-a",
					taskId: "two",
					conditionId: "auto",
					repetition: 1,
					timedOut: false,
					transcriptTruncated: false,
					usageObserved: true,
					verified: true,
					durationMs: 220,
					inputTokens: 1500,
					outputTokens: 310,
					safetyViolations: 0,
				},
			],
		});

		assert.deepEqual(report.conditions.plain, {
			runs: 2,
			verifiedRuns: 1,
			verifiedRate: 0.5,
			medianDurationMs: 150,
			medianTokens: 1450,
			timedOutRuns: 0,
			transcriptTruncatedRuns: 1,
			usageObservedRuns: 2,
			safetyViolations: 0,
		});
		assert.equal(report.conditions.auto.verifiedRate, 1);
		assert.equal(report.paired.verifiedRateDelta, 0.5);
		assert.deepEqual(report.paired.outcomes, {
			improved: 1,
			regressed: 0,
			tiedPass: 1,
			tiedFail: 0,
		});
		assert.equal("score" in report, false);
	});

	it("refuses incomplete or duplicate pairs", () => {
		assert.throws(
			() =>
				summarizeBenchmark({
					suite: "bad",
					conditions: ["plain", "auto"],
					baselineConditionId: "plain",
					treatmentConditionId: "auto",
					provenance,
					...planFields("bad", expectedRuns),
					runs: [
						{
							runId: "only",
							taskId: "one",
							conditionId: "plain",
							repetition: 1,
							timedOut: false,
							transcriptTruncated: false,
							usageObserved: false,
							verified: true,
							durationMs: 1,
							safetyViolations: 0,
						},
					],
				}),
			/frozen run matrix/,
		);
	});

	it("refuses a pair-complete subset that omits frozen tasks", () => {
		assert.throws(
			() =>
				summarizeBenchmark({
					suite: "truncated",
					conditions: ["plain", "auto"],
					baselineConditionId: "plain",
					treatmentConditionId: "auto",
					provenance,
					...planFields("truncated", expectedRuns.slice(0, 2)),
					runs: [
						{
							runId: "1-p",
							taskId: "one",
							conditionId: "plain",
							repetition: 1,
							timedOut: false,
							transcriptTruncated: false,
							usageObserved: false,
							verified: true,
							durationMs: 1,
							safetyViolations: 0,
						},
						{
							runId: "1-a",
							taskId: "one",
							conditionId: "auto",
							repetition: 1,
							timedOut: false,
							transcriptTruncated: false,
							usageObserved: false,
							verified: true,
							durationMs: 1,
							safetyViolations: 0,
						},
					],
				}),
			/frozen run matrix/,
		);
	});

	it("refuses malformed or negative result metrics", () => {
		assert.throws(
			() =>
				summarizeBenchmark({
					suite: "bad",
					conditions: ["plain", "auto"],
					baselineConditionId: "plain",
					treatmentConditionId: "auto",
					provenance,
					...planFields("bad", expectedRuns.slice(0, 2)),
					runs: [
						{
							runId: "p",
							taskId: "one",
							conditionId: "plain",
							repetition: 1,
							timedOut: false,
							transcriptTruncated: false,
							usageObserved: false,
							verified: true,
							durationMs: -1,
							safetyViolations: 0,
						},
						{
							runId: "a",
							taskId: "one",
							conditionId: "auto",
							repetition: 1,
							timedOut: false,
							transcriptTruncated: false,
							usageObserved: false,
							verified: true,
							durationMs: 1,
							safetyViolations: 0,
						},
					],
				}),
			/benchmark results are invalid/,
		);
	});

	it("refuses a result that reverses baseline and treatment roles", () => {
		assert.throws(
			() =>
				summarizeBenchmark({
					suite: "bad",
					conditions: ["auto", "plain"],
					baselineConditionId: "plain",
					treatmentConditionId: "auto",
					provenance,
					...planFields("bad", expectedRuns),
					runs: expectedRuns.map((run) => ({
						...run,
						timedOut: false,
						transcriptTruncated: false,
						usageObserved: false,
						verified: true,
						durationMs: 1,
						safetyViolations: 0,
					})),
				}),
			/comparison roles/,
		);
	});
});
