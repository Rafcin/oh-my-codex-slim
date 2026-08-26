import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyPublicDocs } from "../verify-doc-assets.js";

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
});
