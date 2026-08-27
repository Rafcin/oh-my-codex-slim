import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	opendir,
	readlink,
	rm,
	symlink,
} from "node:fs/promises";
import { describe, it } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function cloneTree(source: string, destination: string): Promise<void> {
	const status = await lstat(source);
	if (status.isSymbolicLink()) {
		await symlink(await readlink(source), destination);
		return;
	}
	if (status.isFile()) {
		await copyFile(source, destination, constants.COPYFILE_FICLONE);
		return;
	}
	assert.equal(status.isDirectory(), true);
	await mkdir(destination);
	const directory = await opendir(source);
	for await (const entry of directory)
		await cloneTree(join(source, entry.name), join(destination, entry.name));
}

describe("slim package binary contract", () => {
	it("prevents publishing the legacy omx binary instead of the omcs executable", () => {
		const pkg = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf8"),
		) as {
			bin?: unknown;
			engines?: { node?: unknown };
			name?: unknown;
			version?: unknown;
			type?: unknown;
			license?: unknown;
		};

		assert.deepEqual(pkg.bin, { omcs: "dist/cli/omcs.js" });
		assert.equal(pkg.name, "oh-my-codex-slim");
		assert.equal(pkg.version, "0.1.0");
		assert.equal(pkg.type, "module");
		assert.equal(pkg.engines?.node, ">=22.19.0");
		assert.equal(pkg.license, "MIT");
		assert.equal(
			existsSync(join(process.cwd(), "dist", "cli", "omcs.js")),
			true,
		);
		assert.match(
			readFileSync(join(process.cwd(), "dist", "cli", "omcs.js"), "utf8"),
			/^#!\/usr\/bin\/env node/,
		);
	});

	it("packs an executable omcs artifact", () => {
		const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const packed = JSON.parse(result.stdout) as Array<{
			name?: unknown;
			version?: unknown;
			files?: Array<{ path?: unknown; mode?: unknown }>;
		}>;
		assert.equal(packed[0]?.name, "oh-my-codex-slim");
		assert.equal(packed[0]?.version, "0.1.0");
		const executable = packed[0]?.files?.find(
			(file) => file.path === "dist/cli/omcs.js",
		);
		assert.equal(executable?.mode, 0o755);
	});

	it("plans the benchmark from a packed global-layout artifact without a lockfile", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-packed-benchmark-"));
		const packageRoot = join(
			root,
			"lib",
			"node_modules",
			"oh-my-codex-slim",
		);
		try {
			await mkdir(packageRoot, { recursive: true });
			const packed = spawnSync(
				"npm",
				["pack", "--json", "--pack-destination", root],
				{ cwd: process.cwd(), encoding: "utf8" },
			);
			assert.equal(packed.status, 0, packed.stderr || packed.stdout);
			const filename = (JSON.parse(packed.stdout) as Array<{ filename?: unknown }>)[0]
				?.filename;
			assert.equal(typeof filename, "string");
			const extracted = spawnSync(
				"tar",
				[
					"-xzf",
					join(root, filename as string),
					"-C",
					packageRoot,
					"--strip-components",
					"1",
				],
				{ encoding: "utf8" },
			);
			assert.equal(extracted.status, 0, extracted.stderr);
			await cloneTree(
				join(process.cwd(), "node_modules"),
				join(packageRoot, "node_modules"),
			);
			assert.equal(existsSync(join(packageRoot, "package-lock.json")), false);
			const planned = spawnSync(
				process.execPath,
				[
					join(packageRoot, "dist", "cli", "omcs.js"),
					"benchmark",
					"plan",
					join(packageRoot, "bench", "prompt-refinement-pilot.json"),
					"--json",
				],
				{ cwd: packageRoot, encoding: "utf8" },
			);
			assert.equal(planned.status, 0, planned.stderr);
			assert.equal(JSON.parse(planned.stdout).runs.length, 36);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not pack retired telemetry, external adapters, or Rust builders", () => {
		const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const packed = JSON.parse(result.stdout) as Array<{
			files?: Array<{ path?: unknown }>;
		}>;
		const packedPaths = new Set(
			packed[0]?.files
				?.map((file) => file.path)
				.filter((path): path is string => typeof path === "string"),
		);
		const retiredArtifacts = [
			"dist/mcp/lifecycle-telemetry.js",
			"dist/notifications/notifier.js",
			"dist/notifications/http-client.js",
			"dist/notifications/dispatch-cooldown.js",
			"dist/cli/ask.js",
			"dist/scripts/run-provider-advisor.js",
			"dist/scripts/test-reply-listener-live.js",
			"dist/scripts/build-sparkshell.js",
			"dist/scripts/build-explore-harness.js",
			"dist/scripts/build-api.js",
			"dist/scripts/test-sparkshell.js",
			"dist/scripts/check-version-sync.js",
		];
		for (const artifact of retiredArtifacts) {
			assert.equal(
				packedPaths.has(artifact),
				false,
				`packed artifact must not retain ${artifact}`,
			);
		}
	});

	it("does not publish compiled tests or test-only artifacts", () => {
		const result = spawnSync("npm", ["pack", "--json", "--dry-run"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const packed = JSON.parse(result.stdout) as Array<{
			files?: Array<{ path?: unknown }>;
		}>;
		const packedPaths =
			packed[0]?.files
				?.map((file) => file.path)
				.filter((path): path is string => typeof path === "string") ?? [];
		const testArtifact =
			/(?:^|\/)__tests__(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.(?:js|d\.ts)(?:\.map)?$/;
		const benchmarkFixtureTest =
			/^bench\/fixtures\/[a-z0-9-]+\/test\/[a-z0-9-]+\.test\.js$/;

		assert.equal(
			packedPaths.filter(
				(path) => testArtifact.test(path) && !benchmarkFixtureTest.test(path),
			).length,
			0,
			"published artifact must exclude compiled tests and their declarations/maps",
		);
		assert.equal(
			packedPaths.filter((path) => benchmarkFixtureTest.test(path)).length,
			5,
			"published benchmark fixtures must retain only the five declared visible tests",
		);
		assert.equal(
			packedPaths.some((path) => path.startsWith("bench/oracles/")),
			false,
			"oracle solutions must not ship",
		);
		assert.equal(
			packedPaths.includes("dist/cli/omcs.js"),
			true,
			"published artifact must retain the CLI",
		);
		assert.equal(
			packedPaths.includes("dist/config/generator.js"),
			true,
			"published artifact must retain production runtime modules",
		);
	});
});
