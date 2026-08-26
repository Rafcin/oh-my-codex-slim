import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectRoute } from "../risk.js";

describe("Sol-guided routing policy", () => {
	it("keeps council requests outside delivery routing", () => {
		assert.deepEqual(selectRoute({ settled: true, blastRadius: "wide", reviewRequired: true, visual: true, councilRequested: true }), {
			mode: "full",
			implementer: "omcs_designer",
			reviewer: "omcs_reviewer",
		});
	});

	it("keeps unsettled reviewed work architect-owned with a fresh audit", () => {
		assert.deepEqual(selectRoute({ settled: false, blastRadius: "narrow", reviewRequired: true, delegable: true }), {
			mode: "audit",
			reviewer: "omcs_reviewer",
		});
	});

	it("uses audit for reviewed work that is not delegated", () => {
		assert.deepEqual(selectRoute({ settled: true, blastRadius: "moderate", reviewRequired: true, delegable: false }), {
			mode: "audit",
			reviewer: "omcs_reviewer",
		});
	});

	it("uses full with Terra for reviewed wide-blast delegated work", () => {
		assert.deepEqual(selectRoute({ settled: true, blastRadius: "wide", reviewRequired: true, delegable: true }), {
			mode: "full",
			implementer: "omcs_terra_fixer",
			reviewer: "omcs_reviewer",
		});
	});

	it("uses the designer for visual implementation and Luna for bounded settled work", () => {
		assert.deepEqual(selectRoute({ settled: true, blastRadius: "narrow", reviewRequired: false, visual: true, delegable: true }), {
			mode: "delegate",
			implementer: "omcs_designer",
		});
		assert.deepEqual(selectRoute({ settled: true, blastRadius: "moderate", reviewRequired: false, delegable: true }), {
			mode: "delegate",
			implementer: "omcs_fixer",
		});
	});
});
