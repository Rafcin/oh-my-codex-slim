import { createHash } from "node:crypto";
import { z } from "zod";

import type { BenchmarkPlan, BenchmarkRunPlan } from "./plan.js";
import type { BenchmarkProvenance } from "./snapshot.js";

export interface BenchmarkRunResult {
	runId: string;
	taskId: string;
	conditionId: string;
	repetition: number;
	timedOut: boolean;
	transcriptTruncated: boolean;
	usageObserved: boolean;
	verified: boolean;
	durationMs: number;
	inputTokens?: number;
	outputTokens?: number;
	safetyViolations: number;
}

export interface BenchmarkResults {
	suite: string;
	conditions: [string, string] | string[];
	baselineConditionId: string;
	treatmentConditionId: string;
	provenance: BenchmarkProvenance;
	planSha256: string;
	plan: BenchmarkPlan;
	expectedRuns: BenchmarkRunPlan[];
	runs: BenchmarkRunResult[];
}

export interface ConditionSummary {
	runs: number;
	verifiedRuns: number;
	verifiedRate: number;
	medianDurationMs: number;
	medianTokens: number | null;
	timedOutRuns: number;
	transcriptTruncatedRuns: number;
	usageObservedRuns: number;
	safetyViolations: number;
}

const resultIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const provenanceSchema = z
	.object({
		suiteSha256: sha256Schema,
		codexCliVersion: z.string().min(1).max(200),
		omcsPackageVersion: z.string().min(1).max(100),
		omcsPluginSha256: sha256Schema,
		omcsRuntimeSha256: sha256Schema,
		benchmarkHarnessSha256: sha256Schema,
		nodeRuntimeSha256: sha256Schema,
		nodeVersion: z.string().min(1).max(100),
		graderImage: z.string().min(1).max(300),
		tasks: z.record(
			resultIdentifier,
			z
				.object({
					fixtureSha256: sha256Schema,
					graderSha256: sha256Schema,
					promptSha256: sha256Schema,
				})
				.strict(),
		),
	})
	.strict();
const benchmarkRunResultSchema = z
	.object({
		runId: resultIdentifier,
		taskId: resultIdentifier,
		conditionId: resultIdentifier,
		repetition: z.number().int().positive(),
		timedOut: z.boolean(),
		transcriptTruncated: z.boolean(),
		usageObserved: z.boolean(),
		verified: z.boolean(),
		durationMs: z.number().int().nonnegative(),
		inputTokens: z.number().int().nonnegative().optional(),
		outputTokens: z.number().int().nonnegative().optional(),
		safetyViolations: z.number().int().nonnegative(),
	})
	.strict();
const benchmarkRunPlanSchema = z
	.object({
		runId: resultIdentifier,
		taskId: resultIdentifier,
		conditionId: resultIdentifier,
		repetition: z.number().int().positive(),
	})
	.strict();
const benchmarkPlanSchema = z
	.object({
		schemaVersion: z.literal(1),
		suite: resultIdentifier,
		controls: z
			.object({
				model: z.string().min(1).max(200),
				reasoningEffort: z.enum([
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
					"ultra",
				]),
				sandbox: z.enum(["read-only", "workspace-write"]),
				timeoutSeconds: z.number().int().positive(),
				seed: z.string().min(1).max(200),
			})
			.strict(),
		provenance: provenanceSchema,
		runs: z.array(benchmarkRunPlanSchema).min(1),
	})
	.strict();
const benchmarkResultsSchema = z
	.object({
		suite: resultIdentifier,
		conditions: z.array(resultIdentifier).length(2),
		baselineConditionId: resultIdentifier,
		treatmentConditionId: resultIdentifier,
		provenance: provenanceSchema,
		planSha256: sha256Schema,
		plan: benchmarkPlanSchema,
		expectedRuns: z.array(benchmarkRunPlanSchema).min(1),
		runs: z.array(benchmarkRunResultSchema).min(1),
	})
	.strict();

export function parseBenchmarkResults(value: unknown): BenchmarkResults {
	const parsed = benchmarkResultsSchema.safeParse(value);
	if (!parsed.success) throw new Error("benchmark results are invalid");
	const recomputedPlanSha256 = createHash("sha256")
		.update(JSON.stringify(parsed.data.plan))
		.digest("hex");
	if (
		recomputedPlanSha256 !== parsed.data.planSha256 ||
		parsed.data.plan.suite !== parsed.data.suite ||
		JSON.stringify(parsed.data.plan.provenance) !==
			JSON.stringify(parsed.data.provenance) ||
		JSON.stringify(parsed.data.plan.runs) !==
			JSON.stringify(parsed.data.expectedRuns)
	)
		throw new Error("benchmark results do not match the frozen plan");
	const expectedById = new Map(
		parsed.data.expectedRuns.map((run) => [run.runId, run] as const),
	);
	if (
		expectedById.size !== parsed.data.expectedRuns.length ||
		new Set(parsed.data.runs.map((run) => run.runId)).size !==
			parsed.data.runs.length ||
		parsed.data.runs.length !== parsed.data.expectedRuns.length
	)
		throw new Error("benchmark results do not match the frozen run matrix");
	for (const run of parsed.data.runs) {
		const expected = expectedById.get(run.runId);
		if (
			!expected ||
			expected.taskId !== run.taskId ||
			expected.conditionId !== run.conditionId ||
			expected.repetition !== run.repetition
		)
			throw new Error("benchmark results do not match the frozen run matrix");
		if (
			run.usageObserved !==
			(run.inputTokens !== undefined && run.outputTokens !== undefined)
		)
			throw new Error("benchmark results have inconsistent usage coverage");
	}
	const expectedTaskIds = new Set(
		parsed.data.expectedRuns.map((run) => run.taskId),
	);
	if (
		[...expectedTaskIds].some(
			(taskId) => parsed.data.provenance.tasks[taskId] === undefined,
		) ||
		Object.keys(parsed.data.provenance.tasks).some(
			(taskId) => !expectedTaskIds.has(taskId),
		) ||
		parsed.data.expectedRuns.some(
			(run) => !parsed.data.conditions.includes(run.conditionId),
		)
	)
		throw new Error("benchmark results do not match the frozen run matrix");
	return parsed.data;
}

export function parseBenchmarkRunResult(value: unknown): BenchmarkRunResult {
	const parsed = benchmarkRunResultSchema.safeParse(value);
	if (!parsed.success) throw new Error("benchmark progress result is invalid");
	return parsed.data;
}

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function summarizeCondition(runs: BenchmarkRunResult[]): ConditionSummary {
	const tokenTotals = runs
		.filter(
			(run) =>
				run.usageObserved &&
				run.inputTokens !== undefined &&
				run.outputTokens !== undefined,
		)
		.map((run) => (run.inputTokens ?? 0) + (run.outputTokens ?? 0));
	const verifiedRuns = runs.filter((run) => run.verified).length;
	return {
		runs: runs.length,
		verifiedRuns,
		verifiedRate: verifiedRuns / runs.length,
		medianDurationMs: median(runs.map((run) => run.durationMs)),
		medianTokens: tokenTotals.length > 0 ? median(tokenTotals) : null,
		timedOutRuns: runs.filter((run) => run.timedOut).length,
		transcriptTruncatedRuns: runs.filter((run) => run.transcriptTruncated)
			.length,
		usageObservedRuns: runs.filter((run) => run.usageObserved).length,
		safetyViolations: runs.reduce(
			(total, run) => total + run.safetyViolations,
			0,
		),
	};
}

function pairKey(run: BenchmarkRunResult): string {
	return `${run.taskId}:${run.repetition}`;
}

/** Reports paired outcomes directly and deliberately avoids a composite vanity score. */
export function summarizeBenchmark(results: BenchmarkResults): {
	suite: string;
	conditions: Record<string, ConditionSummary>;
	paired: {
		verifiedRateDelta: number;
		outcomes: {
			improved: number;
			regressed: number;
			tiedPass: number;
			tiedFail: number;
		};
	};
} {
	results = parseBenchmarkResults(results);
	if (
		results.conditions.length !== 2 ||
		new Set(results.conditions).size !== 2 ||
		results.runs.length === 0
	) {
		throw new Error("benchmark results must be pair-complete");
	}
	const baselineId = results.baselineConditionId;
	const treatmentId = results.treatmentConditionId;
	if (!baselineId || !treatmentId)
		throw new Error("benchmark results must be pair-complete");
	if (
		baselineId === treatmentId ||
		results.conditions[0] !== baselineId ||
		results.conditions[1] !== treatmentId
	)
		throw new Error("benchmark results must preserve comparison roles");
	const grouped = new Map<string, Map<string, BenchmarkRunResult>>();
	for (const run of results.runs) {
		if (!results.conditions.includes(run.conditionId))
			throw new Error("benchmark results must be pair-complete");
		const pair =
			grouped.get(pairKey(run)) ?? new Map<string, BenchmarkRunResult>();
		if (pair.has(run.conditionId))
			throw new Error("benchmark results must be pair-complete");
		pair.set(run.conditionId, run);
		grouped.set(pairKey(run), pair);
	}
	if ([...grouped.values()].some((pair) => pair.size !== 2))
		throw new Error("benchmark results must be pair-complete");

	const conditions = Object.fromEntries(
		results.conditions.map((condition) => {
			const runs = results.runs.filter((run) => run.conditionId === condition);
			if (runs.length === 0)
				throw new Error("benchmark results must be pair-complete");
			return [condition, summarizeCondition(runs)];
		}),
	);
	const outcomes = { improved: 0, regressed: 0, tiedPass: 0, tiedFail: 0 };
	for (const pair of grouped.values()) {
		const baseline = pair.get(baselineId);
		const treatment = pair.get(treatmentId);
		if (!baseline || !treatment)
			throw new Error("benchmark results must be pair-complete");
		if (!baseline.verified && treatment.verified) outcomes.improved += 1;
		else if (baseline.verified && !treatment.verified) outcomes.regressed += 1;
		else if (baseline.verified) outcomes.tiedPass += 1;
		else outcomes.tiedFail += 1;
	}
	return {
		suite: results.suite,
		conditions,
		paired: {
			verifiedRateDelta:
				conditions[treatmentId]!.verifiedRate -
				conditions[baselineId]!.verifiedRate,
			outcomes,
		},
	};
}
