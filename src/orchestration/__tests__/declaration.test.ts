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
				reviewRequired: true,
				visual: false,
				delegable: true,
				needsResearch: false,
				hasReproduction: true,
				generatedCodeRisk: false,
			},
			councilMetadata: { supported: true, modelLanes: ["native-sol", "native-terra"] },
		}));

		assert.equal(declaration, [
			"OMCS ROUTE",
			"profile: council",
			"mode: full",
			"risk: wide blast radius; review required",
			"skills: context, codebase-design, plan, tdd, ai-slop-cleaner, verification, code-review",
			"agents: architect → terra-fixer → reviewer",
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
				reviewRequired: false,
				visual: false,
				delegable: true,
				needsResearch: false,
				hasReproduction: false,
				generatedCodeRisk: false,
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
				reviewRequired: false,
				visual: false,
				delegable: true,
				needsResearch: true,
				hasReproduction: false,
				generatedCodeRisk: false,
				needsRepositoryMapping: true,
				needsDifficultDiagnosis: true,
			},
		}));

		assert.match(declaration, /^mode: delegate$/m);
		assert.match(declaration, /^agents: architect → explorer \+ librarian \+ oracle → fixer$/m);
	});

	it("rejects hostile direct policy casts instead of interpolating them", () => {
		const safePolicy = selectExecutionPolicy({
			profile: "fast",
			risk: {
				settled: true,
				blastRadius: "narrow",
				reviewRequired: false,
				visual: false,
				delegable: true,
				needsResearch: false,
				hasReproduction: false,
				generatedCodeRisk: false,
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
			reviewRequired: true,
			visual: false,
			delegable: true,
			needsResearch: false,
			hasReproduction: true,
			generatedCodeRisk: false,
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
