import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	MissingRequiredCapabilityError,
	selectExecutionPolicy,
	type RouteMode,
	type WorkSignals,
} from "../policy.js";

const settledRisk: WorkSignals = {
	settled: true,
	blastRadius: "narrow",
	consequence: "low",
	uncertainty: "low",
	delegationValue: false,
	visual: false,
	needsResearch: false,
	hasReproduction: false,
	concreteSlopFinding: false,
};

describe("OMCS thin execution policy", () => {
	it("limits delivery modes to the four native routes", () => {
		const modes: readonly RouteMode[] = ["solo", "delegate", "audit", "full"];
		assert.deepEqual(modes, ["solo", "delegate", "audit", "full"]);
	});

	it("makes auto solo-first with a binding one-auxiliary budget", () => {
		const policy = selectExecutionPolicy({ profile: "auto", risk: settledRisk });

		assert.deepEqual(policy.route, { mode: "solo" });
		assert.deepEqual(policy.skills, ["verification"]);
		assert.deepEqual(policy.supportingAgents, []);
		assert.deepEqual(policy.budget, {
			maxAuxiliaries: 1,
			oneFinalVerificationPath: true,
			repeatVerificationOnlyAfterInputChange: true,
			postGreenEdits: "named-finding-only",
		});
		assert.equal(policy.antiSlop.enabled, false);
	});

	it("does not treat public compatibility as an automatic review requirement", () => {
		const policy = selectExecutionPolicy({
			profile: "auto",
			risk: { ...settledRisk, consequence: "material", blastRadius: "narrow" },
		});

		assert.deepEqual(policy.route, { mode: "solo" });
		assert.deepEqual(policy.skills, ["plan", "verification"]);
	});

	it("uses review when material consequence combines with weak evidence", () => {
		const policy = selectExecutionPolicy({
			profile: "auto",
			risk: {
				...settledRisk,
				settled: false,
				consequence: "material",
				uncertainty: "material",
			},
			capabilities: { checked: ["omcs_reviewer"], available: ["omcs_reviewer"] },
		});

		assert.deepEqual(policy.route, { mode: "audit", reviewer: "omcs_reviewer" });
		assert.deepEqual(policy.skills, ["context", "plan", "verification", "code-review"]);
		assert.deepEqual(policy.capabilities, {
			checked: ["omcs_reviewer"],
			available: ["omcs_reviewer"],
			fallback: null,
		});
	});

	it("falls back from an unavailable optional implementer without trying another lane", () => {
		const policy = selectExecutionPolicy({
			profile: "auto",
			risk: { ...settledRisk, delegationValue: true },
			capabilities: { checked: ["omcs_fixer"], available: [] },
		});

		assert.deepEqual(policy.route, {
			mode: "solo",
			fallback: {
				unavailable: "omcs_fixer",
				from: "delegate",
				reason: "optional-capability-unavailable",
			},
		});
		assert.deepEqual(policy.capabilities.fallback, {
			unavailable: "omcs_fixer",
			from: "delegate",
			reason: "optional-capability-unavailable",
		});
	});

	it("fails closed when a required fresh reviewer was checked and is unavailable", () => {
		assert.throws(() => selectExecutionPolicy({
			profile: "auto",
			risk: {
				...settledRisk,
				consequence: "material",
				uncertainty: "material",
			},
			capabilities: { checked: ["omcs_reviewer"], available: [] },
		}), (error) => {
			assert.ok(error instanceof MissingRequiredCapabilityError);
			assert.equal(error.capability, "omcs_reviewer");
			return true;
		});
	});

	it("retains thorough review without forcing delegation", () => {
		const policy = selectExecutionPolicy({
			profile: "thorough",
			risk: settledRisk,
			capabilities: { checked: ["omcs_reviewer"], available: ["omcs_reviewer"] },
		});

		assert.deepEqual(policy.route, { mode: "audit", reviewer: "omcs_reviewer" });
		assert.equal(policy.budget.maxAuxiliaries, 2);
		assert.ok(policy.skills.includes("code-review"));
		assert.equal(policy.antiSlop.enabled, false);
	});

	it("uses at most one supporting specialist in auto and does not duplicate a delivery auxiliary", () => {
		const policy = selectExecutionPolicy({
			profile: "auto",
			risk: {
				...settledRisk,
				needsRepositoryMapping: true,
				needsResearch: true,
				needsDifficultDiagnosis: true,
			},
		});

		assert.deepEqual(policy.route, { mode: "solo" });
		assert.deepEqual(policy.supportingAgents, ["omcs_explorer"]);
		assert.equal(policy.supportingAgents.length, 1);
	});

	it("keeps council a proven explicit advisory overlay", () => {
		const policy = selectExecutionPolicy({
			profile: "council",
			risk: settledRisk,
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-terra"] },
			capabilities: { checked: ["omcs_reviewer"], available: ["omcs_reviewer"] },
		});

		assert.deepEqual(policy.council, {
			status: "enabled",
			explicit: true,
			advisers: ["native-sol-adviser", "native-terra-adviser"],
			nativeLanes: ["native-sol", "native-terra"],
		});
		assert.deepEqual(policy.route, { mode: "audit", reviewer: "omcs_reviewer" });
	});

	it("activates anti-slop only for a concrete named finding", () => {
		const clean = selectExecutionPolicy({ profile: "thorough", risk: settledRisk });
		const finding = selectExecutionPolicy({
			profile: "auto",
			risk: { ...settledRisk, concreteSlopFinding: true },
		});

		assert.equal(clean.antiSlop.enabled, false);
		assert.equal(clean.skills.includes("ai-slop-cleaner"), false);
		assert.equal(finding.antiSlop.enabled, true);
		assert.equal(finding.skills.includes("ai-slop-cleaner"), true);
	});
});
