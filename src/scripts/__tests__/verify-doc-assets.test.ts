import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assertMonochromeSvg, assertTerminalSvg, parseSvgDiagram, REVIEWED_TERMINAL_FIXTURES, verifyPublicDocs } from "../verify-doc-assets.js";

const repositoryRoot = process.cwd();

describe("public OMCS documentation assets", () => {
	it("accepts the checked-in guides, diagrams, and sanitized terminal fixtures", async () => {
		const report = await verifyPublicDocs({ repositoryRoot });

		assert.equal(report.guides, 10);
		assert.deepEqual(report.diagrams, ["omcs-config-precedence", "omcs-pipeline", "omcs-routing"]);
		assert.deepEqual(report.charts, ["omcs-benchmark-calibration", "omcs-benchmark-results"]);
		assert.deepEqual(report.terminals, ["omcs-configure-project.svg", "omcs-route-declaration.svg", "omcs-verification-receipt.svg"]);
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

	it("ships accessible terminal SVGs and diagrams paired with titled Mermaid sources", async () => {
		for (const terminal of ["omcs-configure-project.svg", "omcs-route-declaration.svg", "omcs-verification-receipt.svg"]) {
			const source = await readFile(join(repositoryRoot, "docs", "assets", terminal), "utf8");
			assert.match(source, /<svg\b[^>]*aria-labelledby="title desc"[^>]*>/i);
			assert.match(source, /<title id="title">[^<]+<\/title>/i);
			assert.match(source, /<desc id="desc">[^<]+<\/desc>/i);
			assertTerminalSvg(source, terminal);
		}

		for (const diagram of ["omcs-pipeline", "omcs-routing", "omcs-config-precedence"]) {
			const source = await readFile(join(repositoryRoot, "docs", "diagrams", `${diagram}.mmd`), "utf8");
			const svg = await readFile(join(repositoryRoot, "docs", "assets", `${diagram}.svg`), "utf8");
			assert.match(source, /^---\ntitle: .+\n---/m);
			assert.match(svg, /<svg\b[^>]*>/i);
			assert.match(svg, /<title\b[^>]*>.+<\/title>/i);
		}
	});

	it("keeps every README chart monochrome and free of decorative effects", async () => {
		for (const name of [
			"omcs-pipeline",
			"omcs-routing",
			"omcs-config-precedence",
			"omcs-benchmark-calibration",
			"omcs-benchmark-results",
		]) {
			const svg = await readFile(join(repositoryRoot, "docs", "assets", `${name}.svg`), "utf8");
			assert.doesNotMatch(svg, /<(?:linearGradient|radialGradient|filter)\b/i, name);
			assert.match(svg, /<svg\b[^>]*aria-labelledby="title desc"[^>]*>/i, `${name} declares its accessible labels`);
			assert.match(svg, /<title id="title">[^<]+<\/title>/i, `${name} identifies its title`);
			assert.match(svg, /<desc id="desc">[^<]+<\/desc>/i, `${name} identifies its description`);
			const colors = [...svg.matchAll(/#[0-9a-f]{6}\b/gi)].map(([color]) => color.toUpperCase());
			assert.ok(colors.length > 0, `${name} has explicit palette colors`);
			assert.deepEqual(
				[...new Set(colors)].sort(),
				[...new Set(colors)].sort().filter((color) => ["#111111", "#525252", "#A3A3A3", "#E5E5E5", "#F5F5F5", "#FFFFFF"].includes(color)),
				`${name} uses only the reviewed monochrome palette`,
			);
		}
	});

	it("rejects named, functional, shorthand, and style-based colors", () => {
		for (const unsafe of [
			'<svg fill="#FFFFFF"><rect fill="red"/></svg>',
			'<svg fill="#FFFFFF"><path stroke="rgb(255, 0, 0)"/></svg>',
			'<svg fill="#FFFFFF"><path color="#f00"/></svg>',
			'<svg fill="#FFFFFF"><path style="fill: #111111"/></svg>',
			'<svg fill="#FFFFFF"><style>path { fill: #111111; }</style></svg>',
		]) assert.throws(() => assertMonochromeSvg(unsafe, "fixture.svg"), /monochrome/i);
	});

	it("keeps terminal SVGs inside the reviewed Ghostty-style palette", () => {
		assert.throws(() => assertTerminalSvg('<svg fill="#FFFFFF"><rect fill="#1E8CF4"/></svg>', "fixture.svg"), /terminal palette/i);
		assert.throws(() => assertTerminalSvg('<svg fill="#171717"><linearGradient id="x"/></svg>', "fixture.svg"), /terminal palette/i);
		for (const unsafe of [
			'<svg fill="#171717" onload="alert(1)"></svg>',
			'<svg fill="#171717"><image href="https://example.test/pixel"/></svg>',
			'<svg fill="#171717" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>',
			'<svg fill="#171717"><animate attributeName="opacity" values="0;1"/></svg>',
			'<svg fill="#171717"><rect filter="url(https://example.test/f.svg#x)"/></svg>',
			'<svg fill="#171717" cursor="url(https://example.test/c.cur),auto"></svg>',
			'<?xml-stylesheet href="https://example.test/x.css"?><svg fill="#171717"></svg>',
			'<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg fill="#171717"></svg>',
		]) assert.throws(() => assertTerminalSvg(unsafe, "fixture.svg"), /terminal palette/i);
	});

	it("rejects malformed SVG XML instead of treating tag-shaped text as a diagram", () => {
		assert.throws(
			() => parseSvgDiagram('<?xml version="1.0"?><svg viewBox="0 0 480 320"><title>Broken</title><g></svg>', "fixture.svg"),
			/well-formed XML/i,
		);
	});

	it("rejects a terminal SVG when its reviewed digest no longer matches the checked-in bytes", async () => {
		const name = "omcs-configure-project.svg";
		await assert.rejects(
			verifyPublicDocs({
				repositoryRoot,
				terminalReviewManifest: { ...REVIEWED_TERMINAL_FIXTURES, [name]: { ...REVIEWED_TERMINAL_FIXTURES[name], sha256: "0".repeat(64) } },
			}),
			/reviewed digest does not match/i,
		);
	});

	it("keeps each reviewed terminal transcription exact, without stale or omitted visible lines", () => {
		assert.deepEqual(REVIEWED_TERMINAL_FIXTURES, {
			"omcs-configure-project.svg": {
				sha256: "67f77e2d08f404b695f5e0092152c0c8d684ea19db69608bedc1d8ac26fd8c5f",
				visibleText: [
					"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$",
					"omcs configure --scope project --profile auto --dry-run --json", "{", '"scope": "project",', '"action": "would-create",',
					'"path": "/Users/example/acme-widget/omcs.config.json",', '"bytes": 398,', '"effectiveProfile": "auto"', "}", "dry run only · no project file was written",
				],
			},
			"omcs-route-declaration.svg": {
				sha256: "02c9849833ccb28e67fc43e99f985c39ec44f3b87446697ecc7e47224e32e79d",
				visibleText: [
					"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$", "Use OMCS to solve this issue", "OMCS ROUTE", "profile: auto", "mode: full",
					"risk: wide blast radius; review required", "skills: context · codebase-design · plan · tdd · ai-slop-cleaner · verification · code-review",
					"agents: architect → explorer + librarian → terra-fixer → reviewer", "council: disabled", "approval: material-decisions", "understanding complete", "design ready for approval", "implementation pending",
				],
			},
			"omcs-verification-receipt.svg": {
				sha256: "8b9fc5fb1acc7ed8f30074c7baa0311c685815266ce08fc97eba2931d55bef14",
				visibleText: [
					"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$", "cat ./.omcs/runs/<receipt>.json", "{", '"schemaVersion": 1,', '"profile": "auto",', '"route": "full",',
					'"skills": ["tdd", "verification"],', '"agents": ["omcs_architect", "omcs_reviewer"],', '"approval": "material-decisions",',
					'"verification": [{"command": "npm test", "outcome": "passed"}],', '"review": {"verdict": "ship"}', "}", "verification: npm test passed · review: ship",
				],
			},
		});
	});
});
