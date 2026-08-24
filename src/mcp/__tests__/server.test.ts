import assert from "node:assert/strict";
import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, it } from "node:test";
import {
	astReplace,
	astSearch,
	MAX_INSPECTED_FILE_BYTES,
	type ChildProcessRunner,
} from "../ast.js";
import { buildCodeMap, MAX_CODEMAP_FILE_BYTES } from "../codemap.js";
import {
	languageServerConfigurationsFromEnvironment,
	runLanguageServerOperation,
} from "../lsp.js";
import { TOOL_NAMES, createCodeIntelServer } from "../server.js";

const temporaryDirectories: string[] = [];

async function projectFixture(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("OMCS code-intelligence MCP protocol", () => {
	it("lists exactly the six v1 tools through the MCP protocol", async () => {
		const [clientTransport, serverTransport] = (
			await import("@modelcontextprotocol/sdk/inMemory.js")
		).InMemoryTransport.createLinkedPair();
		const server = createCodeIntelServer();
		const client = new Client({ name: "omcs-test", version: "1.0.0" });
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		try {
			const listed = await client.listTools();
			assert.deepEqual(
				listed.tools.map((tool) => tool.name).sort(),
				[...TOOL_NAMES].sort(),
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("rejects a caller-selected root outside the trusted server root allowlist", async () => {
		const allowedRoot = await projectFixture("omcs-authorized-root-");
		const outsideRoot = await projectFixture("omcs-outside-root-");
		await writeFile(join(outsideRoot, "example.ts"), "const untouched = 1;\n");
		const [clientTransport, serverTransport] = (
			await import("@modelcontextprotocol/sdk/inMemory.js")
		).InMemoryTransport.createLinkedPair();
		const server = createCodeIntelServer({ allowedRoots: [allowedRoot] });
		const client = new Client({
			name: "omcs-authorization-test",
			version: "1.0.0",
		});
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		try {
			const response = await client.callTool({
				name: "omcs_ast_replace",
				arguments: {
					root: outsideRoot,
					path: "example.ts",
					pattern: "untouched",
					replacement: "changed",
					language: "typescript",
					dryRun: false,
				},
			});
			const content = (
				response as { content: Array<{ type: string; text?: string }> }
			).content[0];
			assert.deepEqual(JSON.parse(content?.text ?? "{}"), {
				ok: false,
				error: {
					code: "project-root-not-authorized",
					message: "Requested project root is not authorized by the MCP host",
				},
			});
			assert.equal(
				await readFile(join(outsideRoot, "example.ts"), "utf8"),
				"const untouched = 1;\n",
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("serializes success and failure through the uniform tool-result envelope", async () => {
		const root = await projectFixture("omcs-protocol-envelope-");
		await writeFile(join(root, "example.ts"), "export const value = 1;\n");
		const [clientTransport, serverTransport] = (
			await import("@modelcontextprotocol/sdk/inMemory.js")
		).InMemoryTransport.createLinkedPair();
		const server = createCodeIntelServer({ allowedRoots: [root] });
		const client = new Client({ name: "omcs-envelope-test", version: "1.0.0" });
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		try {
			const success = await client.callTool({
				name: "omcs_codemap",
				arguments: { root, path: "." },
			});
			const successText = (
				success as { content: Array<{ type: string; text?: string }> }
			).content[0];
			assert.equal(successText?.type, "text");
			assert.equal(
				JSON.parse(
					successText?.type === "text" ? (successText.text ?? "{}") : "{}",
				).ok,
				true,
			);

			const failure = await client.callTool({
				name: "omcs_symbols",
				arguments: { root, path: "example.ts" },
			});
			const failureText = (
				failure as { content: Array<{ type: string; text?: string }> }
			).content[0];
			assert.equal(failureText?.type, "text");
			assert.deepEqual(
				JSON.parse(
					failureText?.type === "text" ? (failureText.text ?? "{}") : "{}",
				),
				{
					ok: false,
					error: {
						code: "language-server-unavailable",
						message: "No explicitly configured language server is available",
					},
				},
			);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("rejects every schema mismatch with invalid-arguments through the protocol", async () => {
		const root = await projectFixture("omcs-protocol-validation-");
		await writeFile(join(root, "example.ts"), "export const value = 1;\n");
		const [clientTransport, serverTransport] = (
			await import("@modelcontextprotocol/sdk/inMemory.js")
		).InMemoryTransport.createLinkedPair();
		const server = createCodeIntelServer();
		const client = new Client({
			name: "omcs-validation-test",
			version: "1.0.0",
		});
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
		try {
			const invalidCalls = [
				{
					name: "omcs_ast_search",
					arguments: { root, pattern: "value", language: "typescript" },
				},
				{
					name: "omcs_ast_search",
					arguments: {
						root,
						path: "example.ts",
						pattern: "value",
						language: "typescript",
						extra: true,
					},
				},
				{
					name: "omcs_ast_search",
					arguments: {
						root,
						path: "example.ts",
						pattern: "value",
						language: "typescript",
						maxResults: 0,
					},
				},
				{
					name: "omcs_ast_search",
					arguments: {
						root,
						path: "example.ts",
						pattern: "value",
						language: "typescript",
						maxResults: 1.5,
					},
				},
				{
					name: "omcs_ast_search",
					arguments: {
						root,
						path: "example.ts",
						pattern: "value",
						language: "typescript",
						maxResults: 10_001,
					},
				},
				{
					name: "omcs_ast_replace",
					arguments: {
						root,
						path: "example.ts",
						pattern: "value",
						replacement: "next",
						language: "typescript",
						dryRun: "false",
					},
				},
				{ name: "omcs_codemap", arguments: { root, maxFiles: -1 } },
				{ name: "omcs_codemap", arguments: { root, maxFiles: 2.2 } },
				{ name: "omcs_codemap", arguments: { root, maxFiles: 10_001 } },
			] as const;
			for (const invalidCall of invalidCalls) {
				const response = await client.callTool(invalidCall);
				const content = (
					response as { content: Array<{ type: string; text?: string }> }
				).content[0];
				const result = JSON.parse(content?.text ?? "{}") as {
					ok?: boolean;
					error?: { code?: string };
				};
				assert.equal(result.ok, false, JSON.stringify(invalidCall));
				assert.equal(
					result.error?.code,
					"invalid-arguments",
					JSON.stringify(invalidCall),
				);
			}
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("returns the uniform unavailable envelope when no language server is explicitly configured", async () => {
		const root = await projectFixture("omcs-lsp-unavailable-");
		const result = await runLanguageServerOperation(
			{ root, operation: "diagnostics", path: "." },
			{},
		);
		assert.deepEqual(result, {
			ok: false,
			error: {
				code: "language-server-unavailable",
				message: "No explicitly configured language server is available",
			},
		});
	});

	it("executes only an explicitly configured installed JSON language-server adapter", async () => {
		const root = await projectFixture("omcs-lsp-configured-");
		const adapter = join(root, "fixture-adapter.mjs");
		await writeFile(
			adapter,
			`#!${process.execPath}\nconst request = JSON.parse(process.argv.at(-1));\nprocess.stdout.write(JSON.stringify({operation: request.operation, path: request.path}));\n`,
		);
		await chmod(adapter, 0o700);
		const configurations = languageServerConfigurationsFromEnvironment({
			OMCS_LSP_ADAPTER_BIN: adapter,
		});
		const result = await runLanguageServerOperation(
			{ root, operation: "symbols", path: "fixture-adapter.mjs" },
			configurations,
		);
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal((result.data as { operation: string }).operation, "symbols");
		assert.equal(
			(result.data as { path: string }).path,
			await realpath(adapter),
		);
	});

	it("passes only an allowlisted environment to AST and LSP children", async () => {
		const root = await projectFixture("omcs-child-env-");
		const adapter = join(root, "adapter.mjs");
		await writeFile(adapter, `#!${process.execPath}\n`);
		await chmod(adapter, 0o700);
		const observed: Array<NodeJS.ProcessEnv | undefined> = [];
		const runner: ChildProcessRunner = async (_file, _args, options) => {
			observed.push(options.env);
			return { stdout: "[]", stderr: "" };
		};
		await astSearch(
			{ root, path: "adapter.mjs", pattern: "value", language: "javascript" },
			{ run: runner },
		);
		await runLanguageServerOperation(
			{ root, operation: "symbols", path: "adapter.mjs" },
			languageServerConfigurationsFromEnvironment({
				OMCS_LSP_ADAPTER_BIN: adapter,
			}),
			{ run: runner },
		);
		assert.equal(observed.length, 2);
		for (const environment of observed) {
			const untrustedView = environment as NodeJS.ProcessEnv | undefined;
			assert.deepEqual(environment, {
				LANG: "C",
				LC_ALL: "C",
				PATH: "/usr/bin:/bin",
			});
			assert.equal(untrustedView?.PROVIDER_API_KEY_SENTINEL, undefined);
			assert.equal(untrustedView?.GIT_CONFIG_COUNT, undefined);
		}
	});

	it("launches the real stdio server through the packaged omcs command", async () => {
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [
				join(process.cwd(), "dist", "cli", "omcs.js"),
				"mcp-serve",
				"code-intel",
			],
			env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
			stderr: "pipe",
		});
		const client = new Client({ name: "omcs-cli-test", version: "1.0.0" });
		await client.connect(transport);
		try {
			const listed = await client.listTools();
			assert.deepEqual(
				listed.tools.map((tool) => tool.name).sort(),
				[...TOOL_NAMES].sort(),
			);
		} finally {
			await client.close();
		}
	});

	it("returns tool envelopes without reflecting sensitive external-command arguments", async () => {
		const root = await projectFixture("omcs-redaction-");
		await writeFile(join(root, "example.ts"), "const value = 1;\n");
		const sensitive = "sensitive-command-argument";
		const result = await astSearch({
			root,
			path: "example.ts",
			pattern: "value",
			language: sensitive,
		});
		assert.equal(result.ok, false);
		assert.doesNotMatch(JSON.stringify(result), new RegExp(sensitive));
	});
});

describe("deterministic code-intelligence operations", () => {
	it("searches and atomically replaces a file with the project-pinned ast-grep executable", async () => {
		const root = await projectFixture("omcs-ast-");
		await writeFile(
			join(root, "example.ts"),
			"const oldName = 1;\nconsole.log(oldName);\n",
		);

		const searched = await astSearch({
			root,
			path: "example.ts",
			pattern: "oldName",
			language: "typescript",
		});
		assert.equal(searched.ok, true, JSON.stringify(searched));
		assert.ok(Array.isArray(searched.data));
		assert.equal((searched.data as unknown[]).length, 2);

		const replaced = await astReplace({
			root,
			path: "example.ts",
			pattern: "oldName",
			replacement: "newName",
			language: "typescript",
			dryRun: false,
		});
		assert.equal(replaced.ok, true, JSON.stringify(replaced));
		assert.equal(
			await readFile(join(root, "example.ts"), "utf8"),
			"const newName = 1;\nconsole.log(newName);\n",
		);
		const backup = (replaced.data as { backup: string }).backup;
		assert.equal(
			await readFile(join(root, backup), "utf8"),
			"const oldName = 1;\nconsole.log(oldName);\n",
		);
	});

	it("rejects AST targets above the inspection byte budget", async () => {
		const root = await projectFixture("omcs-ast-budget-");
		await writeFile(
			join(root, "oversized.ts"),
			Buffer.alloc(MAX_INSPECTED_FILE_BYTES + 1, 0x20),
		);
		const result = await astSearch({
			root,
			path: "oversized.ts",
			pattern: "value",
			language: "typescript",
		});
		assert.deepEqual(result, {
			ok: false,
			error: {
				code: "resource-limit",
				message: "Project file exceeds the inspection byte limit",
			},
		});
	});

	it("builds a stable repository map without traversing excluded runtime directories", async () => {
		const root = await projectFixture("omcs-codemap-");
		await writeFile(join(root, "z.ts"), "export const z = 1;\n");
		await writeFile(join(root, "a.ts"), "export function a() {}\n");
		const ignored = join(root, "node_modules");
		await (await import("node:fs/promises")).mkdir(ignored);
		await writeFile(
			join(ignored, "ignored.ts"),
			"export const ignored = true;\n",
		);

		const result = await buildCodeMap({ root, path: "." });
		assert.equal(result.ok, true);
		assert.deepEqual(
			(result.data as { files: Array<{ path: string }> }).files.map(
				(file) => file.path,
			),
			["a.ts", "z.ts"],
		);
	});

	it("rejects codemap files above the per-file byte budget", async () => {
		const root = await projectFixture("omcs-codemap-budget-");
		await writeFile(
			join(root, "oversized.ts"),
			Buffer.alloc(MAX_CODEMAP_FILE_BYTES + 1, 0x20),
		);
		const result = await buildCodeMap({ root, path: "." });
		assert.deepEqual(result, {
			ok: false,
			error: {
				code: "resource-limit",
				message: "Codemap file exceeds the per-file byte limit",
			},
		});
	});

	it("rejects codemap directories above the bounded entry budget", async () => {
		const root = await projectFixture("omcs-codemap-entry-budget-");
		await Promise.all(
			Array.from({ length: 9 }, (_, index) =>
				writeFile(join(root, `ignored-${index}.txt`), ""),
			),
		);
		const result = await buildCodeMap(
			{ root, path: "." },
			{ maxEntries: 8, maxEntriesPerDirectory: 8 },
		);
		assert.deepEqual(result, {
			ok: false,
			error: {
				code: "resource-limit",
				message: "Codemap traversal exceeds the directory entry limit",
			},
		});
	});

	it("excludes a nested vendor tree even when it is the requested codemap start", async () => {
		const root = await projectFixture("omcs-codemap-nested-vendor-");
		await mkdir(join(root, "packages", "app", "node_modules", "vendor"), {
			recursive: true,
		});
		await writeFile(
			join(root, "packages", "app", "node_modules", "vendor", "index.ts"),
			"export const hidden = true;\n",
		);
		const result = await buildCodeMap({
			root,
			path: "packages/app/node_modules/vendor",
		});
		assert.deepEqual(result, {
			ok: true,
			data: { files: [], truncated: false },
		});
	});
});
