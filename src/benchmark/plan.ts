import { createHash } from "node:crypto";

import type { BenchmarkSuite } from "./manifest.js";
import type { BenchmarkProvenance } from "./snapshot.js";

export interface BenchmarkRunPlan {
	runId: string;
	taskId: string;
	conditionId: string;
	repetition: number;
}

export interface BenchmarkPlan {
	schemaVersion: 1;
	suite: string;
	controls: {
		model: string;
		reasoningEffort: BenchmarkSuite["reasoningEffort"];
		sandbox: BenchmarkSuite["sandbox"];
		timeoutSeconds: number;
		seed: string;
	};
	provenance: BenchmarkProvenance;
	runs: BenchmarkRunPlan[];
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Creates a deterministic random order while retaining complete within-task pairs. */
export function planBenchmark(
	suite: BenchmarkSuite,
	provenance: BenchmarkProvenance,
): BenchmarkPlan {
	const runs: Array<BenchmarkRunPlan & { order: string }> = [];
	for (const task of suite.tasks) {
		for (let repetition = 1; repetition <= suite.repetitions; repetition += 1) {
			for (const condition of suite.conditions) {
				const identity = `${suite.name}:${task.id}:${repetition}:${condition.id}`;
				runs.push({
					runId: digest(identity).slice(0, 16),
					taskId: task.id,
					conditionId: condition.id,
					repetition,
					order: digest(`${suite.seed}:${identity}`),
				});
			}
		}
	}
	runs.sort((left, right) => left.order.localeCompare(right.order));
	return {
		schemaVersion: 1,
		suite: suite.name,
		controls: {
			model: suite.model,
			reasoningEffort: suite.reasoningEffort,
			sandbox: suite.sandbox,
			timeoutSeconds: suite.timeoutSeconds,
			seed: suite.seed,
		},
		provenance,
		runs: runs.map(({ order: _order, ...run }) => run),
	};
}
