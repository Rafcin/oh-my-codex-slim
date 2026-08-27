import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBenchmarkSuite } from "../manifest.js";

const validSuite = {
	schemaVersion: 1,
	name: "prompt-refinement-pilot",
	model: "gpt-5.6-terra",
	reasoningEffort: "high",
	sandbox: "workspace-write",
	timeoutSeconds: 900,
	repetitions: 3,
	seed: "prompt-refinement-v1",
	conditions: [
		{ id: "codex-default", kind: "codex-default" },
		{ id: "omcs-auto", kind: "omcs", profile: "auto" },
	],
	tasks: [
		{
			id: "bounded-bugfix",
			title: "Repair a bounded parsing bug",
			category: "bugfix",
			fixture: "../fixtures/bounded-bugfix",
			prompt: "Fix the parsing regression and prove the result.",
			grader: ["node", "--test", "grader.test.js"],
			graderAssets: ["grader.test.js"],
		},
	],
};

describe("benchmark suite manifests", () => {
	it("accepts a paired plain-Codex and OMCS suite", () => {
		const suite = parseBenchmarkSuite(validSuite);
		assert.equal(suite.conditions[0]?.kind, "codex-default");
		assert.equal(suite.conditions[1]?.kind, "omcs");
		assert.equal(suite.tasks[0]?.category, "bugfix");
	});

	it("rejects unsafe paths and shell-string graders", () => {
		assert.throws(
			() =>
				parseBenchmarkSuite({
					...validSuite,
					tasks: [
						{
							...validSuite.tasks[0],
							fixture: "/tmp/private",
							grader: "npm test && curl example.test",
						},
					],
				}),
			/benchmark suite is invalid/,
		);
	});

	it("requires unique task and condition identifiers with both comparison arms", () => {
		assert.throws(
			() =>
				parseBenchmarkSuite({
					...validSuite,
					conditions: [validSuite.conditions[1]],
					tasks: [validSuite.tasks[0], validSuite.tasks[0]],
				}),
			/benchmark suite is invalid/,
		);
	});

	it("requires the plain Codex baseline before the OMCS treatment", () => {
		assert.throws(
			() =>
				parseBenchmarkSuite({
					...validSuite,
					conditions: [...validSuite.conditions].reverse(),
				}),
			/benchmark suite is invalid/,
		);
	});
});
