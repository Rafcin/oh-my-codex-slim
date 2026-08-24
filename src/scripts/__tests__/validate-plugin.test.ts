import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validatePlugin } from "../validate-plugin.js";

describe("repository-owned plugin validator", () => {
	it("accepts the packaged OMCS plugin", async () => {
		await validatePlugin(join(process.cwd(), "plugins", "oh-my-codex-slim"));
	});

	it("rejects a malformed plugin without using a mutable user validator", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-bad-plugin-"));
		try {
			await mkdir(join(root, ".codex-plugin"));
			await writeFile(join(root, ".codex-plugin", "plugin.json"), "{}\n");
			await assert.rejects(validatePlugin(root), /plugin|manifest|name/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
