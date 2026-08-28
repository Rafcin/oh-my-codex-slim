import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectRoute } from "../risk.js";

describe("OMCS thin routing kernel", () => {
	it("defaults settled low-uncertainty work to solo", () => {
		assert.deepEqual(selectRoute({
			settled: true,
			blastRadius: "narrow",
			consequence: "low",
			uncertainty: "low",
			delegationValue: false,
		}), { mode: "solo" });
	});

	it("does not force review merely because a narrow surface is public or user-visible", () => {
		assert.deepEqual(selectRoute({
			settled: true,
			blastRadius: "narrow",
			consequence: "low",
			uncertainty: "low",
			delegationValue: false,
			visual: true,
		}), { mode: "solo" });
	});

	it("uses one reviewer for material consequence combined with material uncertainty", () => {
		assert.deepEqual(selectRoute({
			settled: false,
			blastRadius: "moderate",
			consequence: "material",
			uncertainty: "material",
			delegationValue: false,
		}), { mode: "audit", reviewer: "omcs_reviewer" });
	});

	it("does not spend two auxiliaries when the profile budget is one", () => {
		assert.deepEqual(selectRoute({
			settled: true,
			blastRadius: "wide",
			consequence: "material",
			uncertainty: "low",
			delegationValue: true,
			maxAuxiliaries: 1,
		}), { mode: "audit", reviewer: "omcs_reviewer" });
	});

	it("delegates only when a bounded packet has concrete value", () => {
		assert.deepEqual(selectRoute({
			settled: true,
			blastRadius: "moderate",
			consequence: "low",
			uncertainty: "low",
			delegationValue: true,
			maxAuxiliaries: 1,
		}), { mode: "delegate", implementer: "omcs_fixer" });
	});

	it("lets thorough work use one implementer plus a fresh reviewer when valuable", () => {
		assert.deepEqual(selectRoute({
			settled: true,
			blastRadius: "wide",
			consequence: "material",
			uncertainty: "low",
			delegationValue: true,
			forceReview: true,
			maxAuxiliaries: 2,
		}), {
			mode: "full",
			implementer: "omcs_terra_fixer",
			reviewer: "omcs_reviewer",
		});
	});
});
