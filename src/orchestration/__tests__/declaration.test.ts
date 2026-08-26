import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderRouteDeclaration } from "../declaration.js";
import { selectExecutionPolicy } from "../policy.js";

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
			"approval: material-decisions",
		].join("\n"));
	});

	it("renders only curated policy fields, never supplied runtime metadata", () => {
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
			councilMetadata: { supported: true, modelLanes: ["secret-token-value", "/Users/person/private"] },
		}));

		assert.equal(declaration.includes("secret-token-value"), false);
		assert.equal(declaration.includes("/Users/person/private"), false);
		assert.equal(declaration.includes("council:"), false);
	});
});
