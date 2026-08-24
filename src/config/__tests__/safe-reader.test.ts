import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readBoundedRegularFile } from "../safe-reader.js";

describe("descriptor-bound safe reader", () => {
	it("rejects a named path replaced after opening and never returns replacement bytes", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-safe-reader-"));
		const path = join(root, "state.json");
		try {
			await writeFile(path, "owned\n");
			await assert.rejects(readBoundedRegularFile(path, { afterOpen: async () => {
				await rename(path, `${path}.old`);
				await writeFile(path, "replacement\n");
			} }), /changed|identity/i);
			assert.equal(await readFile(path, "utf8"), "replacement\n");
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects a named path removed after opening instead of reporting it absent", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-safe-reader-"));
		const path = join(root, "state.json");
		try {
			await writeFile(path, "owned\n");
			await assert.rejects(readBoundedRegularFile(path, { afterOpen: async () => { await rm(path); } }), /changed|identity/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("rejects oversized, symlinked, and multiply-linked files", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "omcs-safe-reader-"));
		try {
			await writeFile(join(root, "large"), Buffer.alloc(33));
			await assert.rejects(readBoundedRegularFile(join(root, "large"), { maxBytes: 32 }), /unsafe|size/i);
			await writeFile(join(root, "owned"), "owned");
			await symlink(join(root, "owned"), join(root, "link"));
			await assert.rejects(readBoundedRegularFile(join(root, "link")), /unsafe|symbolic|loop/i);
			await link(join(root, "owned"), join(root, "copy"));
			await assert.rejects(readBoundedRegularFile(join(root, "owned")), /unsafe|link/i);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
