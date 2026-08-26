import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDelegationPacket } from "../packets.js";

describe("delegation packets", () => {
	it("renders the seven mandatory delegation sections with concurrent-work and return safeguards", () => {
		assert.equal(buildDelegationPacket({
			objective: "Make parser failures observable to callers.",
			ownership: ["src/parser.ts", "src/parser.test.ts"],
			interfaces: ["Keep parse(input: string) compatible with existing callers."],
			context: ["The input is UTF-8.", "The public API is stable."],
			constraints: ["Do not change callers.", "Exclude parser format migrations."],
			verification: ["Run npm test -- parser; expect the focused suite to pass."],
			returnContract: ["Report changed paths, commands, observed results, exclusions, and remaining risks."],
		}), [
			"## Objective",
			"Make parser failures observable to callers.",
			"",
			"## Ownership",
			"- src/parser.ts",
			"- src/parser.test.ts",
			"",
			"## Interfaces",
			"- Keep parse(input: string) compatible with existing callers.",
			"",
			"## Context",
			"- The input is UTF-8.",
			"- The public API is stable.",
			"",
			"## Constraints",
			"- Do not change callers.",
			"- Exclude parser format migrations.",
			"- Others may edit concurrently; never revert unrelated work.",
			"",
			"## Verification",
			"- Run npm test -- parser; expect the focused suite to pass.",
			"",
			"## Return Contract",
			"- Report changed paths, commands, observed results, exclusions, and remaining risks.",
			"- Return a structured report to the parent when the owned work is complete.",
		].join("\n"));
	});

	it("rejects empty mandatory sections and duplicate ownership paths", () => {
		const completePacket = {
			objective: "Implement the parser.",
			ownership: ["src/parser.ts"],
			interfaces: ["Public API is stable."],
			context: ["Known context."],
			constraints: ["Stay scoped."],
			verification: ["Tests pass."],
			returnContract: ["Report results."],
		};
		for (const [label, incomplete] of [
			["objective", { ...completePacket, objective: " " }],
			["ownership", { ...completePacket, ownership: [] }],
			["interfaces", { ...completePacket, interfaces: [] }],
			["context", { ...completePacket, context: [] }],
			["constraints", { ...completePacket, constraints: [] }],
			["verification", { ...completePacket, verification: [] }],
			["return contract", { ...completePacket, returnContract: [] }],
		] as const) {
			assert.throws(() => buildDelegationPacket(incomplete), new RegExp(label, "i"));
		}

		assert.throws(() => buildDelegationPacket({
			...completePacket,
			ownership: ["src/parser.ts", " src/parser.ts "],
		}), /duplicate ownership/i);
	});
});
