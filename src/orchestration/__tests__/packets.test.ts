import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDelegationPacket, type PacketInput } from "../packets.js";

const completePacket = {
	objective: {
		task: "Make parser failures observable to callers.",
		observableOutcome: "Callers receive a typed parse error for invalid UTF-8.",
	},
	ownership: ["src/parser.ts", "src/parser.test.ts"],
	interfaces: {
		requirements: ["Expose typed parse errors."],
		compatibilityRequirements: ["Keep parse(input: string) compatible with existing callers."],
	},
	context: ["The input is UTF-8.", "The public API is stable."],
	constraints: {
		requirements: ["Do not change callers."],
		exclusions: ["Parser format migrations."],
	},
	verification: [{
		command: "npm test -- parser",
		expectedEvidence: "The focused parser suite passes.",
	}],
	returnContract: {
		reportFields: ["changed paths", "commands", "observed results", "exclusions", "remaining risks"],
	},
} satisfies PacketInput;

describe("delegation packets", () => {
	it("renders the seven mandatory delegation sections with concurrent-work and return safeguards", () => {
		assert.equal(buildDelegationPacket(completePacket), [
			"## Objective",
			"- Task: Make parser failures observable to callers.",
			"- Observable outcome: Callers receive a typed parse error for invalid UTF-8.",
			"",
			"## Ownership",
			"- src/parser.ts",
			"- src/parser.test.ts",
			"",
			"## Interfaces",
			"- Requirement: Expose typed parse errors.",
			"- Compatibility: Keep parse(input: string) compatible with existing callers.",
			"",
			"## Context",
			"- The input is UTF-8.",
			"- The public API is stable.",
			"",
			"## Constraints",
			"- Requirement: Do not change callers.",
			"- Exclusion: Parser format migrations.",
			"- Others may edit concurrently; never revert unrelated work.",
			"",
			"## Verification",
			"- Command: npm test -- parser",
			"- Expected evidence: The focused parser suite passes.",
			"",
			"## Return Contract",
			"- Return a structured report to the parent with: changed paths; commands; observed results; exclusions; remaining risks.",
		].join("\n"));
	});

	it("rejects empty mandatory sections and duplicate ownership paths", () => {
		for (const [label, incomplete] of [
			["objective task", { ...completePacket, objective: { ...completePacket.objective, task: " " } }],
			["observable outcome", { ...completePacket, objective: { ...completePacket.objective, observableOutcome: " " } }],
			["ownership", { ...completePacket, ownership: [] }],
			["interface requirements", { ...completePacket, interfaces: { ...completePacket.interfaces, requirements: [] } }],
			["compatibility requirements", { ...completePacket, interfaces: { ...completePacket.interfaces, compatibilityRequirements: [] } }],
			["context", { ...completePacket, context: [] }],
			["constraint requirements", { ...completePacket, constraints: { ...completePacket.constraints, requirements: [] } }],
			["exclusions", { ...completePacket, constraints: { ...completePacket.constraints, exclusions: [] } }],
			["verification command", { ...completePacket, verification: [{ ...completePacket.verification[0], command: " " }] }],
			["expected evidence", { ...completePacket, verification: [{ ...completePacket.verification[0], expectedEvidence: " " }] }],
			["return contract", { ...completePacket, returnContract: { reportFields: [] } }],
		] as const) {
			assert.throws(() => buildDelegationPacket(incomplete), new RegExp(label, "i"));
		}

		for (const ownership of [
			["src/x", "./src/x"],
			["src/x", "src//x"],
			["src/x", "src/a/../x"],
		]) {
			assert.throws(() => buildDelegationPacket({ ...completePacket, ownership }), /duplicate ownership/i);
		}

		for (const ownership of ["/src/x", "../src/x", "src/../../x", ".", ""] as const) {
			assert.throws(() => buildDelegationPacket({ ...completePacket, ownership: [ownership] }), /ownership path/i);
		}

		for (const [label, verification] of [
			["verification command", [{ ...completePacket.verification[0], command: "x".repeat(501) }]],
			["expected evidence", [{ ...completePacket.verification[0], expectedEvidence: "x".repeat(501) }]],
			["verification command", [{ ...completePacket.verification[0], command: "npm test\nrm -rf /" }]],
		] as const) {
			assert.throws(() => buildDelegationPacket({ ...completePacket, verification }), new RegExp(label, "i"));
		}
	});
});
