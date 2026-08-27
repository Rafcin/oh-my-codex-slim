import { z } from "zod";

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relativePath = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("\0") &&
			!value.includes("\\") &&
			!value.startsWith("/") &&
			!/^[A-Za-z]:/.test(value),
		"must be a portable relative path",
	);

const conditionSchema = z.discriminatedUnion("kind", [
	z.object({ id: identifier, kind: z.literal("codex-default") }).strict(),
	z
		.object({
			id: identifier,
			kind: z.literal("omcs"),
			profile: z.enum(["auto", "fast", "thorough"]),
		})
		.strict(),
]);

const taskSchema = z
	.object({
		id: identifier,
		title: z.string().min(1).max(160),
		category: z.enum([
			"bugfix",
			"feature",
			"diagnosis",
			"refactor",
			"security",
			"docs",
			"visual",
		]),
		fixture: relativePath,
		prompt: z.string().min(1).max(20_000),
		setup: z.array(z.string().min(1)).min(1).max(32).optional(),
		grader: z.array(z.string().min(1)).min(1).max(32),
		graderAssets: z.array(relativePath).min(1).max(32),
	})
	.strict();

const benchmarkSuiteSchema = z
	.object({
		schemaVersion: z.literal(1),
		name: identifier,
		description: z.string().min(1).max(1_000).optional(),
		model: z.string().min(1).max(160),
		reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]),
		sandbox: z.enum(["read-only", "workspace-write"]),
		timeoutSeconds: z.number().int().min(60).max(7_200),
		repetitions: z.number().int().min(1).max(20),
		seed: z.string().min(1).max(160),
		conditions: z.array(conditionSchema).length(2),
		tasks: z.array(taskSchema).min(1).max(200),
	})
	.strict()
	.superRefine((suite, context) => {
		if (
			suite.conditions[0]?.kind !== "codex-default" ||
			suite.conditions[1]?.kind !== "omcs"
		) {
			context.addIssue({
				code: "custom",
				path: ["conditions"],
				message: "plain Codex must be the first, baseline condition",
			});
		}
		const conditionIds = suite.conditions.map((condition) => condition.id);
		if (new Set(conditionIds).size !== conditionIds.length) {
			context.addIssue({
				code: "custom",
				path: ["conditions"],
				message: "condition identifiers must be unique",
			});
		}
		if (
			!suite.conditions.some(
				(condition) => condition.kind === "codex-default",
			) ||
			!suite.conditions.some((condition) => condition.kind === "omcs")
		) {
			context.addIssue({
				code: "custom",
				path: ["conditions"],
				message: "exactly one plain Codex and one OMCS arm are required",
			});
		}
		const taskIds = suite.tasks.map((task) => task.id);
		if (new Set(taskIds).size !== taskIds.length) {
			context.addIssue({
				code: "custom",
				path: ["tasks"],
				message: "task identifiers must be unique",
			});
		}
		for (const [index, task] of suite.tasks.entries()) {
			if (task.grader[0] !== "node") {
				context.addIssue({
					code: "custom",
					path: ["tasks", index, "grader", 0],
					message: "graders must use the pinned Node container",
				});
			}
			if (task.setup && task.setup[0] !== "node") {
				context.addIssue({
					code: "custom",
					path: ["tasks", index, "setup", 0],
					message: "setup must use the pinned Node container",
				});
			}
			const graderScript = task.grader.find(
				(argument, argumentIndex) => argumentIndex > 0 && !argument.startsWith("-"),
			);
			if (!graderScript || !task.graderAssets.includes(graderScript)) {
				context.addIssue({
					code: "custom",
					path: ["tasks", index, "graderAssets"],
					message: "the grader entry point must be a declared snapshot asset",
				});
			}
		}
	});

export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;
export type BenchmarkCondition = BenchmarkSuite["conditions"][number];
export type BenchmarkTask = BenchmarkSuite["tasks"][number];

/** Parses an untrusted benchmark suite without exposing its contents in failures. */
export function parseBenchmarkSuite(value: unknown): BenchmarkSuite {
	const parsed = benchmarkSuiteSchema.safeParse(value);
	if (!parsed.success) throw new Error("benchmark suite is invalid");
	return parsed.data;
}
