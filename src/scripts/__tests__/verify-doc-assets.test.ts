import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseSvgDiagram, REVIEWED_PNG_FIXTURES, verifyPublicDocs } from "../verify-doc-assets.js";

const repositoryRoot = process.cwd();

describe("public OMCS documentation assets", () => {
	it("accepts the checked-in guides, diagrams, and sanitized terminal fixtures", async () => {
		const report = await verifyPublicDocs({ repositoryRoot });

		assert.equal(report.guides, 9);
		assert.deepEqual(report.diagrams, ["omcs-config-precedence", "omcs-pipeline", "omcs-routing"]);
		assert.deepEqual(report.screenshots, ["omcs-configure-project.png", "omcs-route-declaration.png", "omcs-verification-receipt.png"]);
	});

	it("rejects a public documentation tree containing an unsafe sample value", async () => {
		const fixture = await mkdtemp(join(tmpdir(), "omcs-doc-assets-"));
		try {
			await mkdir(join(fixture, "docs", "assets"), { recursive: true });
			await writeFile(join(fixture, "README.md"), "# fixture\n");
			await writeFile(join(fixture, "docs", "assets", "unsafe.svg"), "<svg><title>unsafe</title><text>Authorization: Bearer example-token</text></svg>");

			await assert.rejects(verifyPublicDocs({ repositoryRoot: fixture }), /unsafe public documentation content/i);
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it("ships valid PNG signatures and SVG diagrams paired with titled Mermaid sources", async () => {
		for (const screenshot of ["omcs-configure-project.png", "omcs-route-declaration.png", "omcs-verification-receipt.png"]) {
			const bytes = await readFile(join(repositoryRoot, "docs", "assets", screenshot));
			assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
		}

		for (const diagram of ["omcs-pipeline", "omcs-routing", "omcs-config-precedence"]) {
			const source = await readFile(join(repositoryRoot, "docs", "diagrams", `${diagram}.mmd`), "utf8");
			const svg = await readFile(join(repositoryRoot, "docs", "assets", `${diagram}.svg`), "utf8");
			assert.match(source, /^---\ntitle: .+\n---/m);
			assert.match(svg, /<svg\b[^>]*>/i);
			assert.match(svg, /<title>.+<\/title>/i);
		}
	});

	it("rejects malformed SVG XML instead of treating tag-shaped text as a diagram", () => {
		assert.throws(
			() => parseSvgDiagram('<?xml version="1.0"?><svg viewBox="0 0 480 320"><title>Broken</title><g></svg>', "fixture.svg"),
			/well-formed XML/i,
		);
	});

	it("rejects a PNG when its reviewed digest no longer matches the checked-in bytes", async () => {
		const name = "omcs-configure-project.png";
		await assert.rejects(
			verifyPublicDocs({
				repositoryRoot,
				pngReviewManifest: { ...REVIEWED_PNG_FIXTURES, [name]: { ...REVIEWED_PNG_FIXTURES[name], sha256: "0".repeat(64) } },
			}),
			/reviewed digest does not match/i,
		);
	});

	it("keeps each reviewed PNG transcription exact, without stale or omitted visible lines", () => {
		assert.deepEqual(REVIEWED_PNG_FIXTURES, {
			"omcs-configure-project.png": {
				sha256: "c87d603361e1e4b00a058352bbf1b1ca2c3f193d3e4ba9237b20a4c75d182696",
				visibleText: [
					"acme-widget — deterministic CLI fixture", "example@acme-widget", ":/Users/example/acme-widget $",
					"omcs configure --scope project --profile auto --dry-run --json", "{", '"scope": "project",', '"action": "would-create",',
					'"path": "/Users/example/acme-widget/omcs.config.json",', '"bytes": 398,', '"effectiveProfile": "auto"', "}",
				],
			},
			"omcs-route-declaration.png": {
				sha256: "6dd535368485a38d3d9c4c702efd492f64c16742b564a14662b48b9aa5660e27",
				visibleText: [
					"acme-widget — Codex CLI", "example@acme-widget", ":/Users/example/acme-widget $", "Use OMCS to solve this issue", "OMCS ROUTE", "profile: auto", "mode: full",
					"risk: public interface with persistent configuration", "skills: context, codebase-design, plan, tdd, verification, code-review",
					"agents: architect → explorer + librarian → terra-fixer → reviewer", "approval: material-decisions", "● Understanding complete", "● Design ready for approval", "● Implementation pending",
				],
			},
			"omcs-verification-receipt.png": {
				sha256: "c002ca9e4744144f8ad6a9329e249c78331a70bc8c9be5b6b59985089d7c5828",
				visibleText: [
					"acme-widget — synthetic receipt fixture", "example@acme-widget", ":/Users/example/acme-widget $",
					"cat .omcs/runs/2026-08-26T12-00-00-000Z-12345678-1234-4abc-8def-1234567890ab.json", "{", '"schemaVersion": 1,', '"profile": "auto",', '"route": "full",',
					'"skills": ["tdd", "verification"],', '"agents": ["omcs_architect", "omcs_reviewer"],', '"approval": "material-decisions",',
					'"verification": [{"command": "npm test", "outcome": "passed"}],', '"review": {"verdict": "ship"}', "}",
				],
			},
		});
	});
});
