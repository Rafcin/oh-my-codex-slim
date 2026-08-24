import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDelegationPacket } from "../packets.js";

describe("delegation packets", () => {
	it("renders exactly the five required sections without inventing context", () => {
		assert.equal(buildDelegationPacket({
			objective: "Implement the bounded parser.",
			ownership: ["src/parser.ts", "src/parser.test.ts"],
			context: ["The input is UTF-8.", "The public API is stable."],
			constraints: ["Do not change callers.", "Use TDD."],
			evidenceRequired: ["Focused tests pass.", "Lint is clean."],
		}), [
			"## Objective",
			"Implement the bounded parser.",
			"",
			"## Ownership",
			"- src/parser.ts",
			"- src/parser.test.ts",
			"",
			"## Context",
			"- The input is UTF-8.",
			"- The public API is stable.",
			"",
			"## Constraints",
			"- Do not change callers.",
			"- Use TDD.",
			"",
			"## Evidence Required",
			"- Focused tests pass.",
			"- Lint is clean.",
		].join("\n"));
	});

	it("rejects missing packet sections instead of producing an ambiguous handoff", () => {
		assert.throws(() => buildDelegationPacket({
			objective: " ",
			ownership: ["src/parser.ts"],
			context: ["Known context."],
			constraints: ["Stay scoped."],
			evidenceRequired: ["Tests pass."],
		}), /objective/i);
	});
});
