import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderRouteDeclaration } from "../declaration.js";
import { selectExecutionPolicy, type ExecutionPolicy } from "../policy.js";

describe("OMCS route declarations", () => {
	it("renders the stable machine-auditable declaration layout", () => {
		const declaration = renderRouteDeclaration(selectExecutionPolicy({
			profile: "council",
			risk: {
				settled: true,
				blastRadius: "wide",
				consequence: "material",
				uncertainty: "low",
				delegationValue: true,
				visual: false,
				needsResearch: false,
				hasReproduction: true,
				concreteSlopFinding: false,
			},
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-terra"] },
			capabilities: {
				checked: ["omcs_terra_fixer", "omcs_reviewer"],
				available: ["omcs_terra_fixer", "omcs_reviewer"],
			},
		}));

		assert.equal(declaration, [
			"OMCS ROUTE",
			"profile: council",
			"mode: full",
			"risk: material consequence; low uncertainty; wide blast radius",
			"skills: codebase-design, plan, tdd, verification, code-review",
			"agents: architect → terra-fixer → reviewer",
			"budget: 2 auxiliaries; one final verification path; stop after green",
			"council: enabled; advisers: native-sol-adviser, native-terra-adviser; lanes: native-sol, native-terra",
			"approval: material-decisions",
		].join("\n"));
	});

	it("makes a fail-closed council fallback visible", () => {
		const declaration = renderRouteDeclaration(selectExecutionPolicy({
			profile: "council",
			risk: {
				settled: true,
				blastRadius: "narrow",
				consequence: "low",
				uncertainty: "low",
				delegationValue: false,
				visual: false,
				needsResearch: false,
				hasReproduction: false,
				concreteSlopFinding: false,
			},
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-sol"] },
		}));

		assert.match(declaration, /^council: unavailable \(fail-closed\)$/m);
	});

	it("shows warranted supporting agents without treating them as delivery owners", () => {
		const declaration = renderRouteDeclaration(selectExecutionPolicy({
			profile: "auto",
			risk: {
				settled: true,
				blastRadius: "moderate",
				consequence: "low",
				uncertainty: "low",
				delegationValue: false,
				visual: false,
				needsResearch: true,
				hasReproduction: false,
				concreteSlopFinding: false,
				needsRepositoryMapping: true,
				needsDifficultDiagnosis: true,
			},
		}));

		assert.match(declaration, /^mode: solo$/m);
		assert.match(declaration, /^agents: architect → explorer$/m);
	});

	it("rejects hostile direct policy casts instead of interpolating them", () => {
		const safePolicy = selectExecutionPolicy({
			profile: "fast",
			risk: {
				settled: true,
				blastRadius: "narrow",
				consequence: "low",
				uncertainty: "low",
				delegationValue: false,
				visual: false,
				needsResearch: false,
				hasReproduction: false,
				concreteSlopFinding: false,
			},
		});
		const hostile = {
			...safePolicy,
			risk: { ...safePolicy.risk, blastRadius: "/Users/example/.codex\nTOKEN=$secret prompt text" },
			skills: ["verification\nAPI_KEY=secret"],
		} as unknown as ExecutionPolicy;

		assert.throws(() => renderRouteDeclaration(hostile), /Invalid OMCS route declaration policy/);
	});

	it("rejects forged council profile, lane, and adviser states", () => {
		const councilRisk = {
			settled: true,
			blastRadius: "wide" as const,
			consequence: "material" as const,
			uncertainty: "low" as const,
			delegationValue: true,
			visual: false,
			needsResearch: false,
			hasReproduction: true,
			concreteSlopFinding: false,
		};
		const enabled = selectExecutionPolicy({
			profile: "council",
			risk: councilRisk,
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-terra"] },
		});
		const unavailable = selectExecutionPolicy({
			profile: "council",
			risk: councilRisk,
			councilMetadata: { supported: false, modelLanes: [] },
		});
		const disabled = selectExecutionPolicy({
			profile: "auto",
			risk: councilRisk,
		});

		const forged: unknown[] = [
			{ ...enabled, council: { ...enabled.council, nativeLanes: ["native-sol", "native-sol"] } },
			{ ...enabled, council: { ...enabled.council, advisers: ["native-sol-adviser", "native-sol-adviser"] } },
			{ ...enabled, council: { ...enabled.council, advisers: ["native-luna-adviser", "native-terra-adviser"] } },
			{ ...enabled, council: { ...enabled.council, advisers: ["native-sol-adviser"] } },
			{ ...enabled, council: { ...enabled.council, advisers: ["native-sol-adviser", "native-terra-adviser", "native-luna-adviser"] } },
			{ ...enabled, profile: "auto" },
			{ ...disabled, profile: "council" },
			{ ...unavailable, profile: "fast" },
		];

		for (const policy of forged) {
			assert.throws(() => renderRouteDeclaration(policy as ExecutionPolicy), /Invalid OMCS route declaration policy/);
		}
	});
});
