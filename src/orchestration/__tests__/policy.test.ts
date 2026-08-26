import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectExecutionPolicy, type RouteMode, type WorkSignals } from "../policy.js";

const wideRisk: WorkSignals = {
	settled: true,
	blastRadius: "wide",
	reviewRequired: true,
	visual: false,
	delegable: true,
	needsResearch: false,
	hasReproduction: true,
	generatedCodeRisk: false,
};

describe("OMCS execution policy", () => {
	it("limits delivery modes to the four native routes", () => {
		const modes: readonly RouteMode[] = ["solo", "delegate", "audit", "full"];
		assert.deepEqual(modes, ["solo", "delegate", "audit", "full"]);
	});

	it("makes council a proven, explicit advisory overlay on the thorough route", () => {
		assert.deepEqual(selectExecutionPolicy({
			profile: "council",
			risk: wideRisk,
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-terra"] },
		}), {
			profile: "council",
			route: { mode: "full", implementer: "omcs_terra_fixer", reviewer: "omcs_reviewer" },
			council: { enabled: true, explicit: true, implementer: null },
			skills: ["context", "codebase-design", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"],
			risk: "wide blast radius; review required",
			antiSlop: { enabled: true, scope: "changed-files", beforeReview: true, invalidatesVerificationOnEdit: true },
		});
	});

	it("fails closed to the normal thorough route when diversity is not proven", () => {
		const policy = selectExecutionPolicy({
			profile: "council",
			risk: wideRisk,
			councilMetadata: { supported: false, modelLanes: ["native-sol", "native-sol"] },
		});

		assert.equal(policy.route.mode, "full");
		assert.deepEqual(policy.council, { enabled: false, explicit: true, implementer: null });
	});

	it("keeps fast work direct while preserving verification", () => {
		const policy = selectExecutionPolicy({
			profile: "fast",
			risk: { ...wideRisk, blastRadius: "narrow", reviewRequired: false, hasReproduction: false },
		});

		assert.deepEqual(policy.route, { mode: "delegate", implementer: "omcs_fixer" });
		assert.deepEqual(policy.skills, ["verification"]);
		assert.equal(policy.antiSlop.enabled, false);
	});

	it("scales auto gates from observed signals and does not silently downgrade risk", () => {
		const policy = selectExecutionPolicy({
			profile: "auto",
			risk: {
				...wideRisk,
				settled: false,
				needsResearch: true,
				generatedCodeRisk: true,
			},
		});

		assert.deepEqual(policy.route, { mode: "audit", reviewer: "omcs_reviewer" });
		assert.deepEqual(policy.skills, ["context", "codebase-design", "research", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"]);
		assert.equal(policy.antiSlop.enabled, true);
	});
});
