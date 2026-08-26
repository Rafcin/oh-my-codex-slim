import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { readOmcsPluginRegistration, resolveTrustedCodexExecutable } from "../plugin-registration.js";
import { resolvePackagedOmcsMarketplace } from "../plugin-marketplace.js";

const installed = {
	pluginId: "oh-my-codex-slim@omcs-local",
	name: "oh-my-codex-slim",
	marketplaceName: "omcs-local",
	version: "0.1.0",
	installed: true,
	enabled: true,
	source: { source: "local", path: "/synthetic/repository" },
	marketplaceSource: { sourceType: "local", source: "/synthetic/repository" },
	installPolicy: "AVAILABLE",
	authPolicy: "ON_INSTALL",
};

async function withCodexExecutable<T>(operation: (executable: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), "omcs-codex-command-"));
	try {
		const executable = join(root, "codex");
		await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		await chmod(executable, 0o755);
		return await operation(executable);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("Codex OMCS plugin registration evidence", () => {
	it("resolves the repository marketplace to the OMCS discovery plugin", async () => {
		const marketplace = await resolvePackagedOmcsMarketplace(process.cwd());
		assert.ok(marketplace);
		assert.equal(marketplace?.pluginRoot, join(process.cwd(), "plugins", "oh-my-codex-slim"));
		assert.equal(
			marketplace?.pluginManifestPath,
			join(process.cwd(), "plugins", "oh-my-codex-slim", ".codex-plugin", "plugin.json"),
		);
	});

	it("resolves a supported trusted ~/.bun/bin Codex install to its canonical executable target", async () => {
		const root = await mkdtemp(join(tmpdir(), "omcs-codex-executable-"));
		try {
			const target = join(root, "packages", "codex-cli");
			const shim = join(root, ".bun", "bin", "codex");
			await mkdir(dirname(target), { recursive: true });
			await mkdir(dirname(shim), { recursive: true });
			await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			await chmod(target, 0o755);
			await symlink(target, shim);

			assert.equal(await resolveTrustedCodexExecutable({
				homeDirectory: root,
				runningNodeExecutable: join(root, "missing-node"),
				systemCandidates: [],
			}), await realpath(target));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("accepts only the exact installed and enabled plugin identity", async () => {
		await withCodexExecutable(async (codexExecutable) => {
			assert.equal(await readOmcsPluginRegistration({ codexHome: "/isolated/codex-home", codexExecutable, execute: async () => ({
				stdout: JSON.stringify({ installed: [installed], available: [] }), stderr: "",
			}) }), true);
			assert.equal(await readOmcsPluginRegistration({ codexHome: "/isolated/codex-home", codexExecutable, execute: async () => ({
				stdout: JSON.stringify({ installed: [{ ...installed, enabled: false }], available: [] }), stderr: "",
			}) }), false);
		});
	});

	it("uses the exact read-only command and a credential-free selected-home environment", async () => {
		let observed: { file: string; args: readonly string[]; env?: NodeJS.ProcessEnv } | undefined;
		let expectedExecutable = "";
		await withCodexExecutable(async (codexExecutable) => {
			expectedExecutable = await realpath(codexExecutable);
			return readOmcsPluginRegistration({
				codexHome: "/isolated/codex-home",
				codexExecutable,
				environment: { PATH: "/tmp/injected", OPENAI_API_KEY: "synthetic-secret", CODEX_HOME: "/wrong" },
				execute: async (file, args, options) => {
					observed = { file, args, env: options.env };
					return { stdout: JSON.stringify({ installed: [], available: [] }), stderr: "" };
				},
			});
		});
		assert.equal(observed?.file, expectedExecutable);
		assert.deepEqual(observed?.args, ["plugin", "list", "--json"]);
		assert.equal(observed?.env?.CODEX_HOME, "/isolated/codex-home");
		assert.equal(observed?.env?.OPENAI_API_KEY, undefined);
		assert.doesNotMatch(observed?.env?.PATH ?? "", /injected/);
	});

	it("fails closed without reflecting malformed output", async () => {
		await withCodexExecutable(async (codexExecutable) => assert.rejects(readOmcsPluginRegistration({ codexHome: "/isolated/codex-home", codexExecutable, execute: async () => ({
			stdout: '{"installed":"client_secret=synthetic-secret"}', stderr: "",
		}) }), /incompatible Codex plugin list output/i));
	});
});
