import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, link, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../cli/index.js";
import {
	applyOpenCodexMigration,
	defaultMigrationHomes,
	parseMigrationCliArgs,
	planOpenCodexMigration,
	rollbackOpenCodexMigration,
} from "../migrate-opencodex.js";
import type {
	MigrationCommandExecutor,
	MigrationCommandRequest,
	MigrationPlan,
} from "../migrate-opencodex.js";
import type { MigrationManifest } from "../migration-manifest.js";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../test/fixtures/opencodex/clean/", import.meta.url),
);
const PROVIDER_CHECK = "DeepSeek API key";
const SYNTHETIC_SECRET = "synthetic-provider-secret-never-use";

function digest(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

interface Fixture {
	root: string;
	codexHome: string;
	openCodexHome: string;
	configPath: string;
	catalogPath: string;
	openCodexConfig: Buffer;
	nativeConfig: Buffer;
	routerConfig: Buffer;
	journalPath?: string;
	journalBefore?: Buffer;
	profilePath?: string;
	profileBefore?: Buffer | null;
	profileAfterStop?: Buffer | null;
	journalAfterStop?: Buffer | null;
	openCodexStartConfig?: Buffer;
	openCodexStartProfile?: Buffer | null;
}

interface RouterProviderFixture {
	id: string;
	name: string;
	visible: boolean;
	configured: boolean;
}

async function fixture(t: TestContext): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "omcs-opencodex-migration-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await cp(FIXTURE_ROOT, root, { recursive: true });
	const codexHome = await realpath(join(root, "codex"));
	const openCodexHome = await realpath(join(root, "opencodex"));
	const configPath = join(codexHome, "config.toml");
	const catalogPath = join(codexHome, "opencodex-catalog.json");
	const catalog = await readFile(catalogPath);
	const replace = async (path: string, replacements: Readonly<Record<string, string>>) => {
		let value = await readFile(path, "utf8");
		for (const [from, to] of Object.entries(replacements)) value = value.replaceAll(from, to);
		await writeFile(path, value);
	};
	await replace(configPath, { __CATALOG_PATH__: catalogPath });
	const openCodexConfig = await readFile(configPath);
	const nativeConfig = await readFile(join(codexHome, "native-config.toml"));
	await replace(join(openCodexHome, ".opencodex-owner.json"), {
		__OPENCODEX_HOME__: await realpath(openCodexHome),
	});
	await replace(join(openCodexHome, ".opencodex-uninstall.json"), {
		__OPENCODEX_HOME__: await realpath(openCodexHome),
	});
	await replace(join(openCodexHome, "integrations", "codex.json"), {
		__CATALOG_PATH__: catalogPath,
		__CATALOG_DIGEST__: digest(catalog),
		__CONFIG_DIGEST__: digest(openCodexConfig),
		__NATIVE_DIGEST__: digest(nativeConfig),
		__NATIVE_BYTES_BASE64__: nativeConfig.toString("base64"),
	});
	return {
		root,
		codexHome,
		openCodexHome,
		configPath,
		catalogPath,
		openCodexConfig,
		nativeConfig,
		routerConfig: await readFile(join(codexHome, "router-config.toml")),
	};
}

async function setCatalogModels(state: Fixture, slugs: readonly string[]): Promise<void> {
	const catalog = Buffer.from(JSON.stringify({ models: slugs.map((slug) => ({ slug })) }));
	await writeFile(state.catalogPath, catalog);
	const recordPath = join(state.openCodexHome, "integrations", "codex.json");
	const record = JSON.parse(await readFile(recordPath, "utf8")) as {
		provenance: { entries: Array<{ artifact: { kind: string }; postImage: string }> };
	};
	record.provenance.entries.find((entry) => entry.artifact.kind === "active-catalog")!.postImage = digest(catalog);
	await writeFile(recordPath, JSON.stringify(record));
}

function routerConfigFor(nativeConfig: Buffer): Buffer {
	const source = nativeConfig.toString("utf8");
	const lines = source.split("\n");
	const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
	const insertAt = firstTable === -1 ? lines.length : firstTable;
	lines.splice(insertAt, 0,
		'model_catalog_json = "/synthetic/router/catalog.json"',
		'openai_base_url = "http://127.0.0.1:8787/v1"',
		"",
		"# BEGIN codex-router-managed",
		"[model_providers.codex-router]",
		'name = "Codex Router (external models)"',
		'base_url = "http://127.0.0.1:8787/v1"',
		'wire_api = "responses"',
		"# END codex-router-managed",
		"");
	return Buffer.from(`${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`);
}

function reinjectedLegacyConfigFor(nativeConfig: Buffer, catalogPath: string): Buffer {
	const lines = nativeConfig.toString("utf8").split("\n");
	const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
	const insertAt = firstTable === -1 ? lines.length : firstTable;
	lines.splice(insertAt, 0,
		'model = "deepseek/synthetic-opencodex-model"',
		`model_catalog_json = "${catalogPath}"`,
		"# Auto-injected by opencodex",
		'openai_base_url = "http://127.0.0.1:10100/v1"',
		"");
	return Buffer.from(`${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`);
}

async function legacyJournalFixture(
	t: TestContext,
	options: { exactInjectedHash?: boolean; profileBefore?: Buffer | null } = {},
): Promise<Fixture> {
	const state = await fixture(t);
	await unlink(join(state.openCodexHome, "integrations", "codex.json"));
	const originalConfig = Buffer.from('model = "synthetic-native-model"\n\n[projects."/synthetic/project"]\ntrust_level = "trusted"\n');
	const injectedBeforeDrift = Buffer.from(
		`model = "deepseek/synthetic-opencodex-model"\nmodel_catalog_json = "${state.catalogPath}"\n# Auto-injected by opencodex\nopenai_base_url = "http://127.0.0.1:10100/v1"\n\n[projects."/synthetic/project"]\ntrust_level = "trusted"\n`,
	);
	const drifted = Buffer.from(
		`model = "deepseek/synthetic-opencodex-model"\nmodel_catalog_json = "${state.catalogPath}"\n# Auto-injected by opencodex\nopenai_base_url = "http://127.0.0.1:10100/v1"\nuser_root = "preserve-root"\n\n[marketplaces.omcs-local]\nsource = "/synthetic/omcs"\n\n[mcp_servers.user-owned]\ncommand = "preserve-mcp"\nopenai_base_url = "preserve-nested-base-url"\nmodel_catalog_json = "preserve-nested-catalog"\n\n[hooks]\nafter_agent = ["preserve-hook"]\n\n[projects."/synthetic/project"]\ntrust_level = "trusted"\n\n# Managed by opencodex: native subagent defaults table\n[agents]\n# Managed by opencodex: native subagent default\ndefault_subagent_model = "deepseek/synthetic-opencodex-model"\nuser_extension = "preserve-agent-extension"\n`,
	);
	const expectedNative = options.exactInjectedHash
		? originalConfig
		: Buffer.from(
			`user_root = "preserve-root"\n\n[marketplaces.omcs-local]\nsource = "/synthetic/omcs"\n\n[mcp_servers.user-owned]\ncommand = "preserve-mcp"\nopenai_base_url = "preserve-nested-base-url"\nmodel_catalog_json = "preserve-nested-catalog"\n\n[hooks]\nafter_agent = ["preserve-hook"]\n\n[projects."/synthetic/project"]\ntrust_level = "trusted"\n\n[agents]\nuser_extension = "preserve-agent-extension"\n`,
		);
	const current = options.exactInjectedHash ? injectedBeforeDrift : drifted;
	await writeFile(state.configPath, current);
	const profilePath = join(state.codexHome, "opencodex.config.toml");
	const profileBefore = options.profileBefore === undefined
		? Buffer.from("synthetic injected profile before migration\n")
		: options.profileBefore;
	if (profileBefore) await writeFile(profilePath, profileBefore, { mode: 0o600 });
	const originalProfile = Buffer.from("synthetic original profile\n");
	const journalPath = join(state.codexHome, "opencodex-journal.json");
	const journal = {
		version: 1,
		originalConfig: originalConfig.toString("base64"),
		originalProfile: originalProfile.toString("base64"),
		injectedConfigHash: digest(injectedBeforeDrift),
		injectedProfileHash: profileBefore ? digest(profileBefore) : null,
		injectedOpenaiBaseUrl: "http://127.0.0.1:10100/v1",
		injectedCatalogPath: state.catalogPath,
		pid: 4242,
		timestamp: "2026-08-23T00:00:00.000Z",
	};
	const journalBefore = Buffer.from(`${JSON.stringify(journal)}\n`);
	await writeFile(journalPath, journalBefore, { mode: 0o600 });
	state.openCodexConfig = current;
	state.nativeConfig = expectedNative;
	state.routerConfig = routerConfigFor(expectedNative);
	state.journalPath = journalPath;
	state.journalBefore = journalBefore;
	state.profilePath = profilePath;
	state.profileBefore = profileBefore;
	state.profileAfterStop = originalProfile;
	state.journalAfterStop = options.exactInjectedHash ? null : journalBefore;
	state.openCodexStartConfig = current;
	return state;
}

function healthyDoctor(): string {
	return `${JSON.stringify({
		ok: true,
		checks: [
			{ status: "ok", name: PROVIDER_CHECK, detail: "configured", fix: "No action required." },
			{ status: "ok", name: "Router health", detail: "ready", fix: "No action required." },
		],
	})}\n`;
}

function missingCredentialDoctor(): string {
	return `${JSON.stringify({
		ok: false,
		checks: [
			{ status: "fail", name: PROVIDER_CHECK, detail: "not configured", fix: "Configure it." },
		],
	})}\n`;
}

function executionFixture(
	state: Fixture,
	options: {
		doctor?: "healthy" | "missing";
		failCommand?: (request: MigrationCommandRequest) => Error | undefined;
		failAfterCommand?: (request: MigrationCommandRequest) => Error | undefined;
		onCommand?: (request: MigrationCommandRequest) => Promise<void> | void;
		providers?: readonly RouterProviderFixture[];
		providerResponses?: readonly (readonly RouterProviderFixture[])[];
		openCodexRunning?: boolean;
		routerEnabled?: boolean;
		stopRestoresNative?: boolean;
		stopConfig?: Buffer;
		openCodexVersion?: string;
		liveState?: { openCodexRunning: boolean; routerEnabled: boolean };
	} = {},
): {
	execute: MigrationCommandExecutor;
	calls: MigrationCommandRequest[];
	state: { openCodexRunning: boolean; routerEnabled: boolean };
} {
	const calls: MigrationCommandRequest[] = [];
	const live = options.liveState ?? {
		openCodexRunning: options.openCodexRunning ?? true,
		routerEnabled: options.routerEnabled ?? false,
	};
	let providerProofReads = 0;
	const execute: MigrationCommandExecutor = async (request: MigrationCommandRequest) => {
		calls.push(request);
		await options.onCommand?.(request);
		const failure = options.failCommand?.(request);
		if (failure) throw failure;
		if (request.file === "ocx" && request.args.join(" ") === "service stop") {
			live.openCodexRunning = false;
			if (options.stopRestoresNative !== false) await writeFile(state.configPath, options.stopConfig ?? state.nativeConfig);
			if (state.profilePath && state.profileAfterStop !== undefined) {
				if (state.profileAfterStop === null) await unlink(state.profilePath).catch(() => undefined);
				else await writeFile(state.profilePath, state.profileAfterStop, { mode: 0o600 });
			}
			if (state.journalPath && state.journalAfterStop !== undefined) {
				if (state.journalAfterStop === null) await unlink(state.journalPath).catch(() => undefined);
				else await writeFile(state.journalPath, state.journalAfterStop, { mode: 0o600 });
			}
			const after = options.failAfterCommand?.(request);
			if (after) throw after;
			return { stdout: "service stopped + native Codex restored\n", stderr: "" };
		}
		if (request.file === "ocx" && request.args.join(" ") === "service start") {
			live.openCodexRunning = true;
			await writeFile(state.configPath, state.openCodexStartConfig ?? state.openCodexConfig);
			if (state.profilePath && state.openCodexStartProfile !== undefined) {
				if (state.openCodexStartProfile === null) await unlink(state.profilePath).catch(() => undefined);
				else await writeFile(state.profilePath, state.openCodexStartProfile, { mode: 0o600 });
			} else if (state.profilePath && state.profileBefore) await writeFile(state.profilePath, state.profileBefore, { mode: 0o600 });
			if (state.journalPath && state.journalBefore) await writeFile(state.journalPath, state.journalBefore, { mode: 0o600 });
			const after = options.failAfterCommand?.(request);
			if (after) throw after;
			return { stdout: "service started\n", stderr: "" };
		}
		if (request.file === "ocx" && request.args.join(" ") === "service status") {
			return {
				stdout: live.openCodexRunning
					? "✅ installed and loaded (launchd; synthetic fixture)\n   Serving on port 10100.\nDiagnostics: synthetic fixture\n"
					: "⚠️  installed, not loaded (launchd; synthetic fixture)\n   Registered, but no proxy is answering on port 10100.\nDiagnostics: synthetic fixture\n",
				stderr: "",
			};
		}
		if (request.file === "ocx" && request.args.join(" ") === "--version") {
			return { stdout: `${options.openCodexVersion ?? "opencodex 2.25.0"}\n`, stderr: "" };
		}
		if (request.file === "codex-router" && request.args.join(" ") === "status") {
			return {
				stdout: `${JSON.stringify({
					mode: live.routerEnabled ? "router" : "native",
					model: null,
					model_provider: "openai",
					login_free: false,
					login_free_managed: false,
					provider_mode_state_present: false,
					signed_routing: false,
					signed_routing_managed: false,
					signed_provider_state_present: false,
					router_default_model: null,
					router_default_managed: false,
					openai_base_url: live.routerEnabled ? "http://127.0.0.1:8787/v1" : null,
					model_catalog_json: live.routerEnabled ? "/synthetic/router/catalog.json" : null,
					config_protected: true,
				})}\n${JSON.stringify({ installed: true, loaded: true, state: "running" })}\n${JSON.stringify({ ok: true, service: "codex-router", activity: { state: "idle", active: [], activeCount: 0 } })}\n`,
				stderr: "",
			};
		}
		if (request.file === "codex-router" && request.args.join(" ") === "enable") {
			live.routerEnabled = true;
			await writeFile(state.configPath, state.routerConfig);
			const after = options.failAfterCommand?.(request);
			if (after) throw after;
			return { stdout: "enabled\n", stderr: "" };
		}
		if (request.file === "codex-router" && request.args.join(" ") === "disable") {
			live.routerEnabled = false;
			await writeFile(state.configPath, state.nativeConfig);
			const after = options.failAfterCommand?.(request);
			if (after) throw after;
			return { stdout: "disabled\n", stderr: "" };
		}
		if (request.file === "codex-router" && request.args.join(" ") === "providers list --json") {
			const providers = options.providerResponses?.[providerProofReads++] ?? options.providers ?? [
				{ id: "deepseek", name: "DeepSeek", visible: true, configured: options.doctor !== "missing" },
				{ id: "synthetic-hidden", name: "Synthetic Hidden", visible: false, configured: false },
			];
			return {
				stdout: `${JSON.stringify({
					providers,
				})}\n`,
				stderr: "",
			};
		}
		if (request.file === "codex-router" && request.args.join(" ") === "doctor --json") {
			return {
				stdout: options.doctor === "missing" ? missingCredentialDoctor() : healthyDoctor(),
				stderr: "",
			};
		}
		throw new Error(`Unexpected synthetic command: ${request.file}`);
	};
	return { execute, calls, state: live };
}

async function migrationPlan(
	state: Fixture,
	execute: MigrationCommandExecutor,
	dryRun = false,
	extras: Partial<Parameters<typeof planOpenCodexMigration>[0]> = {},
): Promise<MigrationPlan> {
	return planOpenCodexMigration({
		codexHome: state.codexHome,
		openCodexHome: state.openCodexHome,
		dryRun,
		execute,
		...extras,
	});
}

async function manifest(path: string): Promise<MigrationManifest> {
	return JSON.parse(await readFile(path, "utf8")) as MigrationManifest;
}

test("dry-run reports every change without mutating config or acquiring a provider secret", async (t) => {
	const state = await fixture(t);
	const before = await readFile(state.configPath);
	const { execute, calls } = executionFixture(state);
	const plan = await migrationPlan(state, execute, true);
	assert.deepEqual(
		plan.actions.map((action: { kind: string }) => action.kind),
		["backup-config", "disable-opencodex", "enable-router", "verify-router"],
	);
	assert.deepEqual(await readFile(state.configPath), before);
	assert.deepEqual(calls.map((call) => [call.file, ...call.args]), [
		["ocx", "service", "status"],
		["codex-router", "status"],
		["codex-router", "providers", "list", "--json"],
	]);
	assert.deepEqual(plan.providers, ["deepseek"]);
	assert.equal(plan.credentialsReady, true);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.paths), true);
	assert.equal(Object.isFrozen(plan.actions), true);
	assert.doesNotMatch(
		JSON.stringify(plan),
		/synthetic-provider-secret|apiKey|provider_key|requiredCredentialChecks|runtime|execute|acquire/i,
	);
});

test("dry-run accepts a free-only OpenCodex Zen catalog through exact visible configured opencode-free", async (t) => {
	const state = await fixture(t);
	await setCatalogModels(state, ["opencode-zen/x-preview-f-free"]);
	const { execute } = executionFixture(state, {
		providers: [{ id: "opencode-free", name: "OpenCode Zen Free", visible: true, configured: true }],
	});
	const plan = await migrationPlan(state, execute, true);
	assert.deepEqual(plan.providers, ["opencode-zen"]);
	assert.equal(plan.credentialsReady, true);
	assert.doesNotMatch(JSON.stringify(plan), /x-preview-f-free|https?:|secret|api.?key/i);
});

test("provider readiness ignores unrelated visible unconfigured Router providers", async (t) => {
	const state = await fixture(t);
	const { execute } = executionFixture(state, {
		providers: [
			{ id: "deepseek", name: "DeepSeek", visible: true, configured: true },
			{ id: "unrelated", name: "Unrelated", visible: true, configured: false },
		],
	});
	assert.equal((await migrationPlan(state, execute, true)).credentialsReady, true);
});

test("mixed or non-free OpenCodex Zen catalogs do not satisfy opencode-free", async (t) => {
	for (const slugs of [
		["opencode-zen/x-preview-f-free", "opencode-zen/x-preview-paid"],
		["opencode-zen/x-preview-paid"],
	]) {
		await t.test(slugs.join(","), async (subtest) => {
			const state = await fixture(subtest);
			await setCatalogModels(state, slugs);
			const { execute } = executionFixture(state, {
				providers: [{ id: "opencode-free", name: "OpenCode Zen Free", visible: true, configured: true }],
			});
			assert.equal((await migrationPlan(state, execute, true)).credentialsReady, false);
		});
	}
});

test("hidden or unconfigured opencode-free does not satisfy a free-only OpenCodex Zen catalog", async (t) => {
	for (const provider of [
		{ id: "opencode-free", name: "OpenCode Zen Free", visible: false, configured: true },
		{ id: "opencode-free", name: "OpenCode Zen Free", visible: true, configured: false },
	]) {
		await t.test(`${provider.visible ? "unconfigured" : "hidden"} provider`, async (subtest) => {
			const state = await fixture(subtest);
			await setCatalogModels(state, ["opencode-zen/x-preview-f-free"]);
			const { execute } = executionFixture(state, { providers: [provider] });
			assert.equal((await migrationPlan(state, execute, true)).credentialsReady, false);
		});
	}
});

test("apply refuses a free-only Zen migration when opencode-free becomes unconfigured after planning", async (t) => {
	const state = await fixture(t);
	await setCatalogModels(state, ["opencode-zen/x-preview-f-free"]);
	const readyProvider = { id: "opencode-free", name: "OpenCode Zen Free", visible: true, configured: true };
	const runner = executionFixture(state, {
		providerResponses: [[readyProvider], [{ ...readyProvider, configured: false }]],
	});
	const plan = await migrationPlan(state, runner.execute);
	assert.equal(plan.credentialsReady, true);
	await assert.rejects(applyOpenCodexMigration(plan), /required Router providers are not configured/i);
	assert.equal(runner.calls.filter((call) => call.file === "codex-router" && call.args.join(" ") === "providers list --json").length, 2);
	assert.equal(runner.calls.some((call) => call.file === "ocx" && call.args.join(" ") === "service stop"), false);
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
});

test("Router provider display names cannot substitute for exact OpenCodex provider ids", async (t) => {
	const state = await fixture(t);
	const { execute } = executionFixture(state, {
		providers: [{ id: "not-deepseek", name: "DeepSeek", visible: true, configured: true }],
	});
	assert.equal((await migrationPlan(state, execute, true)).credentialsReady, false);
});

test("OpenCodex 2.25.0 journal plans without integration provenance and exact injected bytes use originalConfig", async (t) => {
	const state = await legacyJournalFixture(t, { exactInjectedHash: true });
	const runner = executionFixture(state);
	const plan = await migrationPlan(state, runner.execute, true);
	assert.equal(plan.digests.native, digest(state.nativeConfig));
	assert.equal(plan.digests.configBefore, digest(state.openCodexConfig));
	assert.deepEqual(runner.calls.map((call) => [call.file, ...call.args]), [
		["ocx", "--version"],
		["ocx", "service", "status"],
		["codex-router", "status"],
		["codex-router", "providers", "list", "--json"],
	]);
});

test("OpenCodex 2.25.0 drift transform preserves every unrelated config surface and journals only paths and digests", async (t) => {
	const state = await legacyJournalFixture(t);
	const runner = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, runner.execute));
	assert.equal(result.phase, "verified");
	assert.deepEqual(await readFile(state.configPath), state.routerConfig);
	const nativeText = state.nativeConfig.toString("utf8");
	for (const preserved of [
		'user_root = "preserve-root"',
		"[marketplaces.omcs-local]",
		"[mcp_servers.user-owned]",
		'openai_base_url = "preserve-nested-base-url"',
		'model_catalog_json = "preserve-nested-catalog"',
		"[hooks]",
		'[projects."/synthetic/project"]',
		'user_extension = "preserve-agent-extension"',
	]) assert.match(nativeText, new RegExp(preserved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(nativeText, /127\.0\.0\.1:10100|Auto-injected by opencodex|default_subagent_model/i);

	const saved = await manifest(result.manifestPath);
	assert.equal(saved.digests.native, digest(state.nativeConfig));
	assert.equal(saved.digests.nativeBackup, digest(state.nativeConfig));
	assert.equal(saved.digests.journalBefore, digest(state.journalBefore!));
	assert.equal(saved.digests.profileBefore, digest(state.profileBefore!));
	for (const backupPath of [saved.paths.backup, saved.paths.nativeBackup, saved.paths.journalBackup, saved.paths.profileBackup]) {
		assert.equal((await stat(backupPath!)).mode & 0o777, 0o600);
	}
	assert.doesNotMatch(JSON.stringify(saved), /127\.0\.0\.1|preserve-root|synthetic-provider-secret|originalConfig|originalProfile/i);
});

test("Router ownership proof rejects deletion of nested user routing-named keys during apply and interrupted-enable adoption", async (t) => {
	for (const mode of ["apply", "adoption"] as const) {
		await t.test(mode, async (subtest) => {
			const state = await legacyJournalFixture(subtest);
			state.routerConfig = Buffer.from(state.routerConfig.toString("utf8")
				.replace('openai_base_url = "preserve-nested-base-url"\n', "")
				.replace('model_catalog_json = "preserve-nested-catalog"\n', ""));
			const runner = executionFixture(state, mode === "adoption" ? {
				failAfterCommand: (request) => request.file === "codex-router" && request.args.join(" ") === "enable"
					? new Error("synthetic process death after destructive Router enable")
					: undefined,
			} : {});
			const plan = await migrationPlan(state, runner.execute);
			if (mode === "apply") {
				await assert.rejects(applyOpenCodexMigration(plan), /Router integration ownership/i);
			} else {
				await assert.rejects(applyOpenCodexMigration(plan), /Router enable failed/i);
				const recovery = executionFixture(state, { liveState: runner.state });
				await assert.rejects(rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute }), /modified outside|ownership/i);
				assert.equal(recovery.calls.some((call) => call.file === "codex-router" && call.args.join(" ") === "disable"), false);
			}
		});
	}
});

test("Router ownership proof treats marker text inside root assignment values as user data", async (t) => {
	for (const markerFamily of ["opencodex", "router"] as const) {
		for (const mode of ["apply", "adoption"] as const) {
			await t.test(`${markerFamily} ${mode}`, async (subtest) => {
				const state = await legacyJournalFixture(subtest);
				const line = markerFamily === "opencodex"
					? 'user_note = "retain # Auto-injected by opencodex"\n'
					: 'user_note = "retain # BEGIN codex-router-managed"\n';
				state.openCodexConfig = Buffer.from(state.openCodexConfig.toString("utf8").replace('user_root = "preserve-root"\n', `user_root = "preserve-root"\n${line}`));
				state.nativeConfig = Buffer.from(state.nativeConfig.toString("utf8").replace('user_root = "preserve-root"\n', `user_root = "preserve-root"\n${line}`));
				state.routerConfig = markerFamily === "opencodex"
					? Buffer.from(routerConfigFor(state.nativeConfig).toString("utf8").replace(line, ""))
					: state.nativeConfig;
				await writeFile(state.configPath, state.openCodexConfig);
				const runner = executionFixture(state, mode === "adoption" ? {
					failAfterCommand: (request) => request.file === "codex-router" && request.args.join(" ") === "enable"
						? new Error("synthetic process death after marker-confused Router enable")
						: undefined,
				} : {});
				const plan = await migrationPlan(state, runner.execute);
				if (mode === "apply") {
					await assert.rejects(applyOpenCodexMigration(plan), /Router integration ownership/i);
				} else {
					await assert.rejects(applyOpenCodexMigration(plan), /Router enable failed/i);
					const recovery = executionFixture(state, { liveState: runner.state });
					await assert.rejects(rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute }), /modified outside|ownership|marker|conflict/i);
					assert.equal(recovery.calls.some((call) => call.file === "codex-router" && call.args.join(" ") === "disable"), false);
				}
			});
		}
	}
});

test("OpenCodex 2.25.0 agents stripping preserves multiline data and supports quoted agents syntax", async (t) => {
	await t.test("multiline marker-looking data", async (subtest) => {
		const state = await legacyJournalFixture(subtest);
		const multiline = 'payload = """\n# Managed by opencodex: native subagent default\ndefault_subagent_model = "user-data-not-ownership"\n"""\n';
		state.openCodexConfig = Buffer.from(state.openCodexConfig.toString("utf8").replace('command = "preserve-mcp"\n', `command = "preserve-mcp"\n${multiline}`));
		state.nativeConfig = Buffer.from(state.nativeConfig.toString("utf8").replace('command = "preserve-mcp"\n', `command = "preserve-mcp"\n${multiline}`));
		state.routerConfig = routerConfigFor(state.nativeConfig);
		await writeFile(state.configPath, state.openCodexConfig);
		const plan = await migrationPlan(state, executionFixture(state).execute, true);
		assert.equal(plan.digests.native, digest(state.nativeConfig));
	});

	await t.test("quoted agents header and managed key", async (subtest) => {
		const state = await legacyJournalFixture(subtest);
		state.openCodexConfig = Buffer.from(state.openCodexConfig.toString("utf8")
			.replace("[agents]", '["agents"]')
			.replace("default_subagent_model =", '"default_subagent_model" ='));
		state.nativeConfig = Buffer.from(state.nativeConfig.toString("utf8").replace("[agents]", '["agents"]'));
		state.routerConfig = routerConfigFor(state.nativeConfig);
		await writeFile(state.configPath, state.openCodexConfig);
		const plan = await migrationPlan(state, executionFixture(state).execute, true);
		assert.equal(plan.digests.native, digest(state.nativeConfig));
	});
});

test("legacy journal ownership failures stop before any mutation", async (t) => {
	const cases: Array<{
		name: string;
		mutate: (state: Fixture) => Promise<void>;
		version?: string;
	}> = [
		{
			name: "owner and uninstall mismatch",
			mutate: async (state) => {
				const path = join(state.openCodexHome, ".opencodex-uninstall.json");
				const value = JSON.parse(await readFile(path, "utf8")) as { ownerId: string };
				value.ownerId = "87654321-4321-4123-8123-abcdefabcdef";
				await writeFile(path, JSON.stringify(value));
			},
		},
		{
			name: "matching non-v4 owner identities",
			mutate: async (state) => {
				for (const name of [".opencodex-owner.json", ".opencodex-uninstall.json"]) {
					const path = join(state.openCodexHome, name);
					const value = JSON.parse(await readFile(path, "utf8")) as { ownerId: string };
					value.ownerId = "00000000-0000-1000-8000-000000000000";
					await writeFile(path, JSON.stringify(value));
				}
			},
		},
		{
			name: "journal symlink",
			mutate: async (state) => {
				const target = `${state.journalPath}.target`;
				await rename(state.journalPath!, target);
				await symlink(target, state.journalPath!);
			},
		},
		{
			name: "journal hard link",
			mutate: async (state) => {
				await link(state.journalPath!, `${state.journalPath}.hardlink`);
			},
		},
		{ name: "malformed journal", mutate: async (state) => writeFile(state.journalPath!, "{malformed") },
		{ name: "unsupported version", version: "opencodex 2.26.0", mutate: async () => undefined },
		{
			name: "missing injected hash",
			mutate: async (state) => {
				const value = JSON.parse(await readFile(state.journalPath!, "utf8")) as Record<string, unknown>;
				delete value.injectedConfigHash;
				await writeFile(state.journalPath!, JSON.stringify(value));
			},
		},
		{
			name: "base URL mismatch",
			mutate: async (state) => {
				const value = JSON.parse(await readFile(state.journalPath!, "utf8")) as Record<string, unknown>;
				value.injectedOpenaiBaseUrl = "http://127.0.0.1:19999/v1";
				await writeFile(state.journalPath!, JSON.stringify(value));
			},
		},
		{
			name: "catalog mismatch",
			mutate: async (state) => {
				const value = JSON.parse(await readFile(state.journalPath!, "utf8")) as Record<string, unknown>;
				value.injectedCatalogPath = join(state.codexHome, "foreign-catalog.json");
				await writeFile(state.journalPath!, JSON.stringify(value));
			},
		},
	];
	for (const item of cases) {
		await t.test(item.name, async (subtest) => {
			const state = await legacyJournalFixture(subtest);
			const before = await readFile(state.configPath);
			await item.mutate(state);
			const runner = executionFixture(state, { openCodexVersion: item.version });
			await assert.rejects(migrationPlan(state, runner.execute), /OpenCodex|journal|ownership|version|catalog|routing/i);
			assert.deepEqual(await readFile(state.configPath), before);
			assert.equal(runner.calls.some((call) =>
				(call.file === "ocx" && ["service stop", "service start"].includes(call.args.join(" ")))
				|| (call.file === "codex-router" && ["enable", "disable"].includes(call.args.join(" ")))), false);
		});
	}
});

test("legacy service stop that drops unrelated drift fails closed in backed-up phase", async (t) => {
	const state = await legacyJournalFixture(t);
	const historicalNative = Buffer.from('model = "synthetic-native-model"\n');
	const runner = executionFixture(state, { stopConfig: historicalNative });
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /expected native|preserve|restore/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "backed-up");
	assert.deepEqual(await readFile(state.configPath), historicalNative);
});

test("legacy exact-hash stop may delete its journal and crash recovery still restores config profile journal and service", async (t) => {
	const state = await legacyJournalFixture(t, { exactInjectedHash: true });
	const runner = executionFixture(state, {
		failAfterCommand: (request) => request.file === "ocx" && request.args.join(" ") === "service stop"
			? new Error("synthetic process death after legacy stop")
			: undefined,
	});
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /OpenCodex service stop failed/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "backed-up");
	await assert.rejects(stat(state.journalPath!), /ENOENT/);

	const recovery = executionFixture(state, { liveState: runner.state });
	const rolledBack = await rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute });
	assert.equal(rolledBack.phase, "rolled-back");
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.deepEqual(await readFile(state.profilePath!), state.profileBefore);
	assert.deepEqual(await readFile(state.journalPath!), state.journalBefore);
	assert.equal(runner.state.openCodexRunning, true);
});

test("legacy rollback refuses a concurrently modified profile before OpenCodex start can overwrite it", async (t) => {
	const state = await legacyJournalFixture(t);
	const forward = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
	const concurrentProfile = Buffer.from("concurrent user profile edit\n");
	await writeFile(state.profilePath!, concurrentProfile, { mode: 0o600 });
	const recovery = executionFixture(state, { liveState: forward.state });
	await assert.rejects(
		rollbackOpenCodexMigration(result.manifestPath, { execute: recovery.execute }),
		/profile.*outside this migration/i,
	);
	assert.deepEqual(await readFile(state.profilePath!), concurrentProfile);
	assert.equal(recovery.calls.some((call) => call.file === "ocx" && call.args.join(" ") === "service start"), false);
});

test("null-profile rollback preserves a replacement introduced after removal validation", async (t) => {
	const state = await legacyJournalFixture(t, { profileBefore: null });
	const forward = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
	const displaced = join(state.codexHome, "displaced-profile.toml");
	const foreign = Buffer.from("foreign replacement after validation\n");
	await assert.rejects(rollbackOpenCodexMigration(result.manifestPath, {
		execute: forward.execute,
		afterOptionalRemoveValidation: async (path) => {
			if (path !== state.profilePath) return;
			await rename(path, displaced);
			await writeFile(path, foreign, { mode: 0o600 });
		},
	}), /profile.*changed|final restore/i);
	assert.deepEqual(await readFile(state.profilePath!), foreign);
	assert.deepEqual(await readFile(displaced), state.profileAfterStop);
});

test("null-profile rollback leaves deterministic fail-closed evidence for unsafe post-validation replacements", async (t) => {
	for (const kind of ["symlink", "directory", "hardlink", "oversized"] as const) {
		await t.test(kind, async (subtest) => {
			const state = await legacyJournalFixture(subtest, { profileBefore: null });
			const forward = executionFixture(state);
			const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
			const displaced = join(state.codexHome, `displaced-profile-${kind}.toml`);
			const foreignTarget = join(state.codexHome, `foreign-profile-${kind}`);
			const quarantine = join(state.codexHome, ".opencodex.config.toml.omcs-remove-quarantine");
			await assert.rejects(rollbackOpenCodexMigration(result.manifestPath, {
				execute: forward.execute,
				afterOptionalRemoveValidation: async (path) => {
					if (path !== state.profilePath) return;
					await rename(path, displaced);
					if (kind === "symlink") {
						await writeFile(foreignTarget, "foreign symlink target\n", { mode: 0o600 });
						await symlink(foreignTarget, path);
					} else if (kind === "directory") {
						await mkdir(path);
						await writeFile(join(path, "foreign.txt"), "foreign directory content\n");
					} else if (kind === "hardlink") {
						await writeFile(foreignTarget, "foreign hard-linked content\n", { mode: 0o600 });
						await link(foreignTarget, path);
					} else {
						await writeFile(path, Buffer.alloc((4 * 1024 * 1024) + 1, 0x78), { mode: 0o600 });
					}
				},
			}), /profile.*changed|quarantine|regular file|oversized|symbolic|link/i);
			const source = await lstat(state.profilePath!);
			if (kind === "symlink") assert.equal(await readlink(state.profilePath!), foreignTarget);
			else if (kind === "directory") assert.equal(await readFile(join(state.profilePath!, "foreign.txt"), "utf8"), "foreign directory content\n");
			else if (kind === "hardlink") {
				assert.ok(source.nlink >= 2);
				assert.equal(await readFile(state.profilePath!, "utf8"), "foreign hard-linked content\n");
			} else assert.equal(source.size, (4 * 1024 * 1024) + 1);
			const quarantinePresent = await lstat(quarantine).then(() => true, (error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return false;
				throw error;
			});
			if (kind === "hardlink" || kind === "oversized") assert.equal(quarantinePresent, true);

			const callsBeforeRetry = forward.calls.length;
			await assert.rejects(
				rollbackOpenCodexMigration(result.manifestPath, { execute: forward.execute }),
				/unresolved removal quarantine|bounded regular uniquely linked file/i,
			);
			assert.equal(forward.calls.slice(callsBeforeRetry).some((call) =>
				(call.file === "ocx" && ["service stop", "service start"].includes(call.args.join(" ")))
				|| (call.file === "codex-router" && ["enable", "disable"].includes(call.args.join(" ")))), false);
			assert.deepEqual(await readFile(displaced), state.profileAfterStop);
		});
	}
});

test("null-profile rollback never overwrites a quarantine occupied after its precheck", async (t) => {
	const state = await legacyJournalFixture(t, { profileBefore: null });
	const forward = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
	const displaced = join(state.codexHome, "displaced-profile-occupied-quarantine.toml");
	const quarantine = join(state.codexHome, ".opencodex.config.toml.omcs-remove-quarantine");
	const foreignProfile = Buffer.from("foreign profile at source path\n");
	const foreignQuarantine = Buffer.from("foreign pre-existing quarantine entry\n");
	await assert.rejects(rollbackOpenCodexMigration(result.manifestPath, {
		execute: forward.execute,
		afterOptionalRemoveValidation: async (path) => {
			if (path !== state.profilePath) return;
			await rename(path, displaced);
			await writeFile(path, foreignProfile, { mode: 0o600 });
			await writeFile(quarantine, foreignQuarantine, { mode: 0o600 });
		},
	}), /profile.*quarantine|changed|exist/i);
	assert.deepEqual(await readFile(state.profilePath!), foreignProfile);
	assert.deepEqual(await readFile(quarantine), foreignQuarantine);
	assert.deepEqual(await readFile(displaced), state.profileAfterStop);

	const callsBeforeRetry = forward.calls.length;
	await assert.rejects(
		rollbackOpenCodexMigration(result.manifestPath, { execute: forward.execute }),
		/unresolved removal quarantine|changed outside this migration/i,
	);
	assert.equal(forward.calls.slice(callsBeforeRetry).some((call) =>
		(call.file === "ocx" && ["service stop", "service start"].includes(call.args.join(" ")))
		|| (call.file === "codex-router" && ["enable", "disable"].includes(call.args.join(" ")))), false);
});

test("legacy interrupted Router enable is adopted only over the recorded expected-native projection", async (t) => {
	const state = await legacyJournalFixture(t);
	state.routerConfig = routerConfigFor(Buffer.from('model = "wrong-historical-native"\n'));
	const forward = executionFixture(state, {
		failAfterCommand: (request) => request.file === "codex-router" && request.args.join(" ") === "enable"
			? new Error("synthetic process death after incompatible Router enable")
			: undefined,
	});
	const plan = await migrationPlan(state, forward.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /Router enable failed/i);
	const recovery = executionFixture(state, { liveState: forward.state });
	await assert.rejects(rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute }), /modified outside|ownership/i);
	assert.equal(recovery.calls.some((call) => call.file === "codex-router" && call.args.join(" ") === "disable"), false);
});

test("legacy rollback retries after Router disable and OpenCodex start side effects", async (t) => {
	for (const crashCommand of ["codex-router disable", "ocx service start"] as const) {
		await t.test(crashCommand, async (subtest) => {
			const state = await legacyJournalFixture(subtest);
			const forward = executionFixture(state);
			const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
			const crashing = executionFixture(state, {
				liveState: forward.state,
				failAfterCommand: (request) => `${request.file} ${request.args.join(" ")}` === crashCommand
					? new Error(`synthetic process death after ${crashCommand}`)
					: undefined,
			});
			await assert.rejects(rollbackOpenCodexMigration(result.manifestPath, { execute: crashing.execute }), /failed; inspect the owning tool/i);
			const recovery = executionFixture(state, { liveState: forward.state });
			const recovered = await rollbackOpenCodexMigration(result.manifestPath, { execute: recovery.execute });
			assert.equal(recovered.phase, "rolled-back");
			assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
			assert.deepEqual(await readFile(state.profilePath!), state.profileBefore);
			assert.deepEqual(await readFile(state.journalPath!), state.journalBefore);
		});
	}
});

test("legacy rollback accepts an owned byte-different restart image then restores the exact pre-migration bytes", async (t) => {
	const state = await legacyJournalFixture(t);
	state.openCodexStartConfig = reinjectedLegacyConfigFor(state.nativeConfig, state.catalogPath);
	assert.notDeepEqual(state.openCodexStartConfig, state.openCodexConfig);
	const runner = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, runner.execute));
	const rolledBack = await rollbackOpenCodexMigration(result.manifestPath, { execute: runner.execute });
	assert.equal(rolledBack.phase, "rolled-back");
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(runner.state.openCodexRunning, true);
});

test("clean migration durably advances every phase using only approved command boundaries", async (t) => {
	const state = await fixture(t);
	let plan!: MigrationPlan;
	const phasesAtCommands: string[] = [];
	const runner = executionFixture(state, {
		onCommand: async () => {
			if (!plan) {
				phasesAtCommands.push("missing");
				return;
			}
			try {
				phasesAtCommands.push((await manifest(plan.manifestPath)).phase);
			} catch {
				phasesAtCommands.push("missing");
			}
		},
	});
	plan = await migrationPlan(state, runner.execute);
	const result = await applyOpenCodexMigration(plan);
	assert.equal(result.phase, "verified");
	assert.deepEqual(await readFile(state.configPath), state.routerConfig);
	assert.deepEqual(
		runner.calls.map((call) => [call.file, ...call.args]),
		[
			["ocx", "service", "status"],
			["codex-router", "status"],
			["codex-router", "providers", "list", "--json"],
			["ocx", "service", "status"],
			["codex-router", "status"],
			["codex-router", "providers", "list", "--json"],
			["ocx", "service", "stop"],
			["ocx", "service", "status"],
			["codex-router", "enable"],
			["codex-router", "status"],
			["codex-router", "doctor", "--json"],
		],
	);
	assert.deepEqual(phasesAtCommands, [
		"missing",
		"missing",
		"missing",
		"missing",
		"missing",
		"backed-up",
		"backed-up",
		"backed-up",
		"opencodex-disabled",
		"opencodex-disabled",
		"router-enabled",
	]);
	const saved = await manifest(result.manifestPath);
	assert.deepEqual(Object.keys(saved).sort(), ["digests", "paths", "phase", "services"]);
	assert.equal(saved.phase, "verified");
	assert.doesNotMatch(JSON.stringify(saved), /stdout|stderr|config.*bytes|provider|secret|api.?key/i);
});

test("unknown OpenCodex catalog ownership refuses before commands, backup, or target mutation", async (t) => {
	const state = await fixture(t);
	const before = await readFile(state.configPath);
	const recordPath = join(state.openCodexHome, "integrations", "codex.json");
	const record = JSON.parse(await readFile(recordPath, "utf8")) as {
		provenance: { entries: Array<{ artifact: { kind: string }; postImage: string }> };
	};
	record.provenance.entries.find((entry) => entry.artifact.kind === "active-catalog")!.postImage =
		"0".repeat(64);
	await writeFile(recordPath, JSON.stringify(record));
	const { execute, calls } = executionFixture(state);
	await assert.rejects(migrationPlan(state, execute), /catalog ownership/i);
	assert.equal(calls.length, 0);
	assert.deepEqual(await readFile(state.configPath), before);
});

test("planner derives both service states and ignores forged caller state claims", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state);
	const plan = await planOpenCodexMigration({
		codexHome: state.codexHome,
		openCodexHome: state.openCodexHome,
		dryRun: true,
		execute: runner.execute,
		openCodexServiceState: "stopped",
		routerServiceState: "enabled",
	} as unknown as Parameters<typeof planOpenCodexMigration>[0]);
	assert.equal(plan.services.openCodexBefore, "running");
	assert.equal(plan.services.routerIntegrationBefore, "disabled");
	assert.equal(plan.services.routerServiceBefore, "running");
	assert.deepEqual(runner.calls.map((call) => [call.file, ...call.args]), [
		["ocx", "service", "status"],
		["codex-router", "status"],
		["codex-router", "providers", "list", "--json"],
	]);
});

test("symlink and hard-link ambiguity fail closed before planning a mutation", async (t) => {
	const hardLinked = await fixture(t);
	await link(hardLinked.configPath, join(hardLinked.codexHome, "config-hardlink.toml"));
	await assert.rejects(migrationPlan(hardLinked, executionFixture(hardLinked).execute), /regular uniquely linked/i);

	const symbolic = await fixture(t);
	const catalogTarget = join(symbolic.codexHome, "catalog-target.json");
	await writeFile(catalogTarget, await readFile(symbolic.catalogPath));
	await unlink(symbolic.catalogPath);
	await symlink(catalogTarget, symbolic.catalogPath);
	await assert.rejects(migrationPlan(symbolic, executionFixture(symbolic).execute), /catalog.*regular uniquely linked/i);

	const metadataSymbolic = await fixture(t);
	const ownerPath = join(metadataSymbolic.openCodexHome, ".opencodex-owner.json");
	const ownerTarget = join(metadataSymbolic.openCodexHome, "owner-target.json");
	await writeFile(ownerTarget, await readFile(ownerPath));
	await unlink(ownerPath);
	await symlink(ownerTarget, ownerPath);
	await assert.rejects(
		migrationPlan(metadataSymbolic, executionFixture(metadataSymbolic).execute),
		/ownership metadata.*regular uniquely linked/i,
	);
});

test("interruption leaves a durable phase and rollback recovers exact original bytes", async (t) => {
	const state = await fixture(t);
	const before = await readFile(state.configPath);
	const runner = executionFixture(state, {
		failCommand: (request) =>
			request.file === "codex-router" && request.args[0] === "enable"
				? new Error("synthetic interruption")
				: undefined,
	});
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /Router enable failed/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "opencodex-disabled");
	await assert.rejects(applyOpenCodexMigration(plan), /incomplete migration/i);
	const rolledBack = await rollbackOpenCodexMigration(plan.manifestPath, {
		execute: executionFixture(state, { liveState: runner.state }).execute,
	});
	assert.equal(rolledBack.phase, "rolled-back");
	assert.deepEqual(await readFile(state.configPath), before);
});

test("provider proof command failures redact synthetic credential material before OpenCodex mutation", async (t) => {
	const state = await fixture(t);
	const before = await readFile(state.configPath);
	const runner = executionFixture(state, {
		failCommand: (request) =>
			request.file === "codex-router" && request.args.join(" ") === "providers list --json"
				? new Error(`provider proof failed: API_KEY=${SYNTHETIC_SECRET}`)
				: undefined,
	});
	await assert.rejects(migrationPlan(state, runner.execute), (error: unknown) => {
		assert.doesNotMatch(String(error), new RegExp(SYNTHETIC_SECRET));
		assert.match(String(error), /Router provider proof failed/i);
		return true;
	});
	assert.deepEqual(await readFile(state.configPath), before);
	for (const call of runner.calls) {
		assert.equal(call.stdin, undefined);
		assert.equal(call.env.OPENAI_API_KEY, undefined);
	}
});

test("every Router migration boundary receives the validated selected Router environment only", async (t) => {
	const state = await fixture(t);
	const selectedEnvironment: NodeJS.ProcessEnv = {
		PATH: "/synthetic/project/node_modules/.bin:/synthetic/user-bin",
		HOME: "/synthetic/home",
		CODEX_HOME: "/must-be-replaced-by-the-fixture-codex-home",
		CODEX_ROUTER_STATE_DIR: "/synthetic/router/state",
		MODEL_ROUTER_LAUNCH_AGENTS_DIR: "/synthetic/router/launch-agents",
		CODEX_ROUTER_HOST: "selected.router.example",
		MODEL_ROUTER_GATEWAY_PORT: "44301",
		CODEX_ROUTER_PORT: "44302",
		CODEX_ROUTER_API_PORT: "44303",
		CODEX_ROUTER_SOURCE_ROOT: "/must/not/pass",
		OPENAI_API_KEY: SYNTHETIC_SECRET,
		AWS_SESSION_TOKEN: "synthetic-session-secret-never-use",
		UNRELATED_VALUE: "must-not-pass",
	};
	const forward = executionFixture(state);
	const result = await applyOpenCodexMigration(
		await migrationPlan(state, forward.execute, false, { environment: selectedEnvironment }),
	);
	const recovery = executionFixture(state, { liveState: forward.state });
	await rollbackOpenCodexMigration(result.manifestPath, {
		execute: recovery.execute,
		environment: selectedEnvironment,
	});
	const calls = [...forward.calls, ...recovery.calls];
	const routerCalls = calls.filter((call) => call.file === "codex-router");
	assert.deepEqual(
		[...new Set(routerCalls.map((call) => call.args.join(" ")))].sort(),
		["disable", "doctor --json", "enable", "providers list --json", "status"],
	);
	for (const call of routerCalls) {
		assert.equal(call.env.CODEX_HOME, state.codexHome);
		assert.equal(call.env.CODEX_ROUTER_STATE_DIR, "/synthetic/router/state");
		assert.equal(call.env.MODEL_ROUTER_LAUNCH_AGENTS_DIR, "/synthetic/router/launch-agents");
		assert.equal(call.env.CODEX_ROUTER_HOST, "selected.router.example");
		assert.equal(call.env.MODEL_ROUTER_GATEWAY_PORT, "44301");
		assert.equal(call.env.CODEX_ROUTER_PORT, "44302");
		assert.equal(call.env.CODEX_ROUTER_API_PORT, "44303");
		assert.equal(call.env.CODEX_ROUTER_SOURCE_ROOT, undefined);
		assert.equal(call.env.OPENAI_API_KEY, undefined);
		assert.equal(call.env.AWS_SESSION_TOKEN, undefined);
		assert.equal(call.env.UNRELATED_VALUE, undefined);
		assert.doesNotMatch(call.env.PATH ?? "", /synthetic|node_modules/);
	}
	for (const call of calls.filter((request) => request.file === "ocx")) {
		assert.deepEqual(Object.keys(call.env).sort(), ["CODEX_HOME", "LANG", "LC_ALL", "OPENCODEX_HOME", "PATH"]);
		assert.equal(call.env.CODEX_HOME, state.codexHome);
		assert.equal(call.env.OPENCODEX_HOME, state.openCodexHome);
	}
});

test("unconfigured visible Router provider stops planning without a credential-transfer surface", async (t) => {
	const state = await fixture(t);
	const before = await readFile(state.configPath);
	const runner = executionFixture(state, { doctor: "missing" });
	const plan = await migrationPlan(state, runner.execute);
	assert.equal(plan.credentialsReady, false);
	assert.deepEqual(plan.providers, ["deepseek"]);
	await assert.rejects(applyOpenCodexMigration(plan), /required Router providers are not configured/i);
	assert.deepEqual(await readFile(state.configPath), before);
	assert.equal(runner.calls.some((call) => call.stdin !== undefined), false);
});

test("forged public plans cannot bypass ownership and runtime invariants", async (t) => {
	const state = await fixture(t);
	const plan = await migrationPlan(state, executionFixture(state).execute);
	const forged = structuredClone(plan) as MigrationPlan;
	await assert.rejects(applyOpenCodexMigration(forged), /authentic migration plan/i);
	assert.throws(() => {
		(plan.paths as { codexConfig: string }).codexConfig = join(state.root, "forged.toml");
	}, TypeError);
});

test("a successful OpenCodex stop followed by process death rolls back from the prior durable phase", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state, {
		failAfterCommand: (request) =>
			request.file === "ocx" && request.args.join(" ") === "service stop"
				? new Error("synthetic process death after stop")
				: undefined,
	});
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /OpenCodex service stop failed/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "backed-up");
	assert.deepEqual(await readFile(state.configPath), state.nativeConfig);
	assert.equal(runner.state.openCodexRunning, false);

	const recovery = executionFixture(state, { liveState: runner.state });
	const result = await rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute });
	assert.equal(result.phase, "rolled-back");
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(runner.state.openCodexRunning, true);
	const callsBeforeRetry = recovery.calls.length;
	await rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute });
	assert.equal(recovery.calls.length, callsBeforeRetry);
});

test("a successful Router enable followed by process death is reconciled and reversed", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state, {
		failAfterCommand: (request) =>
			request.file === "codex-router" && request.args.join(" ") === "enable"
				? new Error("synthetic process death after Router enable")
				: undefined,
	});
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /Router enable failed/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "opencodex-disabled");
	assert.equal(runner.state.routerEnabled, true);
	assert.deepEqual(await readFile(state.configPath), state.routerConfig);

	const recovery = executionFixture(state, { liveState: runner.state });
	await rollbackOpenCodexMigration(plan.manifestPath, { execute: recovery.execute });
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(runner.state.routerEnabled, false);
	assert.equal(runner.state.openCodexRunning, true);
});

test("rollback retries after Router disable and OpenCodex start side effects are idempotent", async (t) => {
	for (const crashCommand of ["codex-router disable", "ocx service start"] as const) {
		await t.test(crashCommand, async (subtest) => {
			const state = await fixture(subtest);
			const forward = executionFixture(state);
			const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
			const crashing = executionFixture(state, {
				liveState: forward.state,
				failAfterCommand: (request) =>
					`${request.file} ${request.args.join(" ")}` === crashCommand
						? new Error(`synthetic process death after ${crashCommand}`)
						: undefined,
			});
			await assert.rejects(
				rollbackOpenCodexMigration(result.manifestPath, { execute: crashing.execute }),
				/failed; inspect the owning tool/i,
			);
			const recovery = executionFixture(state, { liveState: forward.state });
			const recovered = await rollbackOpenCodexMigration(result.manifestPath, {
				execute: recovery.execute,
			});
			assert.equal(recovered.phase, "rolled-back");
			assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
			assert.equal(forward.state.routerEnabled, false);
			assert.equal(forward.state.openCodexRunning, true);
		});
	}
});

test("rollback retries after exact config restore but before the final phase or service restart", async (t) => {
	const state = await fixture(t);
	const forward = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, forward.execute));
	await assert.rejects(
		rollbackOpenCodexMigration(result.manifestPath, {
			execute: forward.execute,
			afterConfigRestore: () => {
				throw new Error("synthetic process death after exact restore");
			},
		}),
		/synthetic process death/i,
	);
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(forward.state.openCodexRunning, false);
	const recovery = executionFixture(state, { liveState: forward.state });
	await rollbackOpenCodexMigration(result.manifestPath, { execute: recovery.execute });
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(forward.state.openCodexRunning, true);
});

test("service stop success is not journaled as OpenCodex-disabled until routing is actually removed", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state, { stopRestoresNative: false });
	const plan = await migrationPlan(state, runner.execute);
	await assert.rejects(applyOpenCodexMigration(plan), /did not restore the proven native Codex config/i);
	assert.equal((await manifest(plan.manifestPath)).phase, "backed-up");
	assert.deepEqual(await readFile(state.configPath), state.openCodexConfig);
	assert.equal(runner.state.openCodexRunning, false);
});

test("rollback rechecks target identity and digest after external commands before replacing it", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, runner.execute));
	const concurrent = Buffer.from("concurrent user config edit\n");
	await assert.rejects(
		rollbackOpenCodexMigration(result.manifestPath, {
			execute: runner.execute,
			beforeFinalRestoreValidation: async () => {
				assert.equal((await readdir(state.codexHome)).some((name) => name.includes(".omcs-restore-")), true);
				await writeFile(state.configPath, concurrent);
			},
		}),
		/changed before final restore/i,
	);
	assert.deepEqual(await readFile(state.configPath), concurrent);
	assert.equal(runner.state.openCodexRunning, false);
	assert.equal((await readdir(state.codexHome)).some((name) => name.includes(".omcs-restore-")), false);
});

test("descriptor-bound restore refuses a target path replaced after opening the validated descriptor", async (t) => {
	const state = await fixture(t);
	const runner = executionFixture(state);
	const result = await applyOpenCodexMigration(await migrationPlan(state, runner.execute));
	const displaced = join(state.codexHome, "displaced-router-config.toml");
	const concurrent = Buffer.from("concurrent replacement after descriptor open\n");
	await assert.rejects(
		rollbackOpenCodexMigration(result.manifestPath, {
			execute: runner.execute,
			afterRestoreTargetOpened: async () => {
				assert.equal((await readdir(state.codexHome)).some((name) => name.includes(".omcs-restore-")), true);
				await rename(state.configPath, displaced);
				await writeFile(state.configPath, concurrent);
			},
		}),
		/changed before final restore/i,
	);
	assert.deepEqual(await readFile(state.configPath), concurrent);
	assert.deepEqual(await readFile(displaced), state.nativeConfig);
	assert.equal((await readdir(state.codexHome)).some((name) => name.includes(".omcs-restore-")), false);
});

test("rollback refuses modified backup or target bytes without overwriting either", async (t) => {
	const changedBackup = await fixture(t);
	const firstPlan = await migrationPlan(changedBackup, executionFixture(changedBackup).execute);
	await applyOpenCodexMigration(firstPlan);
	const firstManifest = await manifest(firstPlan.manifestPath);
	await writeFile(firstManifest.paths.backup, "tampered backup");
	const targetBeforeFirstRollback = await readFile(changedBackup.configPath);
	await assert.rejects(
		rollbackOpenCodexMigration(firstPlan.manifestPath, { execute: executionFixture(changedBackup).execute }),
		/backup.*modified/i,
	);
	assert.deepEqual(await readFile(changedBackup.configPath), targetBeforeFirstRollback);

	const changedTarget = await fixture(t);
	const secondPlan = await migrationPlan(changedTarget, executionFixture(changedTarget).execute);
	await applyOpenCodexMigration(secondPlan);
	await writeFile(changedTarget.configPath, "user changed config after migration\n");
	await assert.rejects(
		rollbackOpenCodexMigration(secondPlan.manifestPath, { execute: executionFixture(changedTarget).execute }),
		/target.*modified/i,
	);
	assert.equal(await readFile(changedTarget.configPath, "utf8"), "user changed config after migration\n");
});

test("rollback rejects symlinked or hard-linked manifests before any command or config write", async (t) => {
	const symbolic = await fixture(t);
	const symbolicRunner = executionFixture(symbolic);
	const symbolicPlan = await migrationPlan(symbolic, symbolicRunner.execute);
	await applyOpenCodexMigration(symbolicPlan);
	const manifestTarget = `${symbolicPlan.manifestPath}.target`;
	await writeFile(manifestTarget, await readFile(symbolicPlan.manifestPath));
	await unlink(symbolicPlan.manifestPath);
	await symlink(manifestTarget, symbolicPlan.manifestPath);
	const callsBeforeSymbolicRollback = symbolicRunner.calls.length;
	await assert.rejects(
		rollbackOpenCodexMigration(symbolicPlan.manifestPath, { execute: symbolicRunner.execute }),
		/manifest.*safe regular file/i,
	);
	assert.equal(symbolicRunner.calls.length, callsBeforeSymbolicRollback);

	const hardLinked = await fixture(t);
	const hardLinkedRunner = executionFixture(hardLinked);
	const hardLinkedPlan = await migrationPlan(hardLinked, hardLinkedRunner.execute);
	await applyOpenCodexMigration(hardLinkedPlan);
	await link(hardLinkedPlan.manifestPath, `${hardLinkedPlan.manifestPath}.hardlink`);
	const callsBeforeHardLinkRollback = hardLinkedRunner.calls.length;
	await assert.rejects(
		rollbackOpenCodexMigration(hardLinkedPlan.manifestPath, { execute: hardLinkedRunner.execute }),
		/manifest.*safe regular file/i,
	);
	assert.equal(hardLinkedRunner.calls.length, callsBeforeHardLinkRollback);
});

test("CLI parser accepts only the approved nested migration syntax and derives safe default homes", async (t) => {
	const state = await fixture(t);
	assert.deepEqual(parseMigrationCliArgs(["opencodex", "--dry-run"]), {
		kind: "apply",
		dryRun: true,
	});
	assert.deepEqual(parseMigrationCliArgs(["opencodex", "--rollback", "/safe/manifest.json"]), {
		kind: "rollback",
		manifestPath: "/safe/manifest.json",
	});
	assert.throws(() => parseMigrationCliArgs(["opencodex", "--router-service", "disabled"]), /unsupported/i);
	assert.deepEqual(
		defaultMigrationHomes(
			{ CODEX_HOME: state.codexHome, OPENCODEX_HOME: state.openCodexHome },
			state.root,
		),
		{ codexHome: state.codexHome, openCodexHome: state.openCodexHome },
	);

	const originalWrite = process.stderr.write;
	const originalExitCode = process.exitCode;
	let stderr = "";
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderr += String(chunk);
		return true;
	}) as typeof process.stderr.write;
	try {
		process.exitCode = undefined;
		await main(["migrate-opencodex", "--dry-run"]);
		assert.equal(process.exitCode, 64);
		assert.match(stderr, /unknown command/i);
	} finally {
		process.stderr.write = originalWrite;
		process.exitCode = originalExitCode;
	}
});
