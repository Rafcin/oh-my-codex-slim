import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	cp,
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	open,
	opendir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

import {
	canonicalizeCodexHome,
	resolveCodexHome,
} from "../config/codex-home.js";
import { AGENT_CATALOG } from "../agents/catalog.js";
import {
	agentRelativePath,
	installAgentCatalog,
	renderAgentToml,
} from "../agents/install.js";
import type { BenchmarkSuite } from "./manifest.js";
import { planBenchmark } from "./plan.js";
import {
	parseBenchmarkResults,
	parseBenchmarkRunResult,
	type BenchmarkResults,
	type BenchmarkRunResult,
} from "./report.js";
import {
	assertExecutionApproved,
	buildCodexInvocation,
	type ExecutionApproval,
} from "./runner.js";
import {
	graderImage,
	inspectBenchmarkSnapshot,
	snapshotBenchmarkSuite,
} from "./snapshot.js";

const maxProcessOutputBytes = 8 * 1024 * 1024;

export interface ExecuteBenchmarkOptions {
	suite: BenchmarkSuite;
	suiteRoot: string;
	outputRoot: string;
	approval: ExecutionApproval;
	codexExecutable?: string;
	codexArgsPrefix?: string[];
	preparedCodexHome?: string;
	preparedToolDirectory?: string;
	activeCodexHome?: string;
	packageRoot?: string;
	resumeDirectory?: string;
	containerExecutable?: string;
	containerArgsPrefix?: string[];
	codexCliVersion?: string;
	omcsPackageVersion?: string;
}

export interface ExecuteBenchmarkResult extends BenchmarkResults {
	resultPath: string;
}

export interface ProcessResult {
	status: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	inputTokens?: number;
	outputTokens?: number;
}

export function codexRunDisposition(result: {
	status: number;
	timedOut: boolean;
}): "complete" | "record-timeout" | "abort" {
	if (result.timedOut) return "record-timeout";
	return result.status === 0 ? "complete" : "abort";
}

const safeEnvironmentKeys = [
	"PATH",
	"TMPDIR",
	"TMP",
	"TEMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"SHELL",
	"SystemRoot",
	"COMSPEC",
	"PATHEXT",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
] as const;

function benchmarkEnvironment(
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of safeEnvironmentKeys)
		if (process.env[key] !== undefined) environment[key] = process.env[key];
	return { ...environment, ...extra };
}

export function benchmarkModelEnvironment(
	toolDirectory: string | undefined,
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const systemPath =
		process.platform === "win32"
			? [process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : undefined]
			: ["/usr/bin", "/bin"];
	return benchmarkEnvironment({
		PATH: [toolDirectory, ...systemPath].filter(Boolean).join(delimiter),
		...extra,
	});
}

async function resolveExecutablePath(executable: string): Promise<string> {
	const candidates = executable.includes(sep)
		? [resolve(executable)]
		: (process.env.PATH ?? "")
				.split(delimiter)
				.filter(Boolean)
				.map((directory) => join(directory, executable));
	for (const candidate of candidates) {
		try {
			await access(candidate, constants.X_OK);
			return await realpath(candidate);
		} catch {
			// Continue until an exact executable path is found.
		}
	}
	throw new Error(`benchmark executable is unavailable: ${executable}`);
}

async function prepareBenchmarkToolDirectory(
	prepared?: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	if (prepared)
		return { path: await realpath(prepared), cleanup: async () => {} };
	const root = await mkdtemp(
		join(await realpath(tmpdir()), "omcs-benchmark-tools-"),
	);
	try {
		const node = join(root, process.platform === "win32" ? "node.exe" : "node");
		await copyFile(process.execPath, node, constants.COPYFILE_EXCL);
		await chmod(node, 0o500);
		return {
			path: root,
			cleanup: async () => rm(root, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

function contained(root: string, candidate: string): boolean {
	const fromRoot = relative(resolve(root), resolve(candidate));
	return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}

async function assertFixtureTreeSafe(root: string): Promise<void> {
	const status = await lstat(root);
	if (status.isSymbolicLink() || !status.isDirectory())
		throw new Error("benchmark fixture must be a real directory");
	const entries = await opendir(root);
	for await (const entry of entries) {
		const path = join(root, entry.name);
		const entryStatus = await lstat(path);
		if (entryStatus.isSymbolicLink())
			throw new Error("benchmark fixtures may not contain symbolic links");
		if (entryStatus.isDirectory()) await assertFixtureTreeSafe(path);
		else if (!entryStatus.isFile())
			throw new Error(
				"benchmark fixtures may contain only files and directories",
			);
	}
}

async function validateSuiteFixtures(
	suiteRoot: string,
	suite: BenchmarkSuite,
): Promise<Map<string, string>> {
	const fixtures = new Map<string, string>();
	for (const task of suite.tasks) {
		const fixture = resolve(suiteRoot, task.fixture);
		if (!contained(suiteRoot, fixture))
			throw new Error("benchmark fixture must stay inside the suite root");
		await assertFixtureTreeSafe(fixture);
		fixtures.set(task.id, fixture);
	}
	return fixtures;
}

function appendBounded(
	current: Buffer[],
	total: { bytes: number; truncated: boolean },
	chunk: Buffer,
): void {
	if (total.bytes >= maxProcessOutputBytes) {
		total.truncated = true;
		return;
	}
	const remaining = maxProcessOutputBytes - total.bytes;
	const kept = chunk.subarray(0, remaining);
	current.push(kept);
	total.bytes += kept.byteLength;
	if (kept.byteLength !== chunk.byteLength) total.truncated = true;
}

function observeUsageLine(
	line: string,
	usage: { inputTokens?: number; outputTokens?: number },
): void {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line) as Record<string, unknown>;
		const value =
			typeof event.usage === "object" && event.usage !== null
				? (event.usage as Record<string, unknown>)
				: event;
		if (
			typeof value.input_tokens === "number" &&
			Number.isFinite(value.input_tokens)
		)
			usage.inputTokens = value.input_tokens;
		if (
			typeof value.output_tokens === "number" &&
			Number.isFinite(value.output_tokens)
		)
			usage.outputTokens = value.output_tokens;
	} catch {
		// Only exact JSONL usage events contribute to efficiency metrics.
	}
}

export async function runProcess(
	command: string,
	args: string[],
	options: {
		cwd: string;
		stdin?: string;
		timeoutMs: number;
		environment?: NodeJS.ProcessEnv;
	},
): Promise<ProcessResult> {
	return await new Promise((resolveProcess, rejectProcess) => {
		const detached = process.platform !== "win32";
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.environment ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
			detached,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const stdoutBytes = { bytes: 0, truncated: false };
		const stderrBytes = { bytes: 0, truncated: false };
		const usage: { inputTokens?: number; outputTokens?: number } = {};
		const usageDecoder = new StringDecoder("utf8");
		let usageLine = "";
		let skippingOversizedUsageLine = false;
		const consumeUsage = (text: string): void => {
			usageLine += text;
			let newline = usageLine.indexOf("\n");
			while (newline >= 0) {
				const line = usageLine.slice(0, newline);
				usageLine = usageLine.slice(newline + 1);
				if (!skippingOversizedUsageLine) observeUsageLine(line, usage);
				skippingOversizedUsageLine = false;
				newline = usageLine.indexOf("\n");
			}
			if (usageLine.length > 1_000_000) {
				usageLine = "";
				skippingOversizedUsageLine = true;
			}
		};
		child.stdout.on("data", (chunk: Buffer) => {
			consumeUsage(usageDecoder.write(chunk));
			appendBounded(stdout, stdoutBytes, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) =>
			appendBounded(stderr, stderrBytes, chunk),
		);
		child.stdin.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "EPIPE") rejectProcess(error);
		});
		child.once("error", rejectProcess);
		let timedOut = false;
		let forceKillTimer: NodeJS.Timeout | undefined;
		const killTree = (signal: NodeJS.Signals): void => {
			if (child.pid === undefined) return;
			try {
				if (detached) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				// The process tree may have already exited between the timer and signal.
			}
		};
		const groupIsAlive = (): boolean => {
			if (!detached || child.pid === undefined) return false;
			try {
				process.kill(-child.pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		const wait = async (milliseconds: number): Promise<void> =>
			await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
		const terminateLingeringGroup = async (): Promise<void> => {
			if (!groupIsAlive()) return;
			killTree("SIGTERM");
			for (let attempt = 0; attempt < 10 && groupIsAlive(); attempt += 1)
				await wait(25);
			if (groupIsAlive()) killTree("SIGKILL");
			for (let attempt = 0; attempt < 20 && groupIsAlive(); attempt += 1)
				await wait(25);
			if (groupIsAlive())
				throw new Error("benchmark process group could not be terminated");
		};
		const timer = setTimeout(() => {
			timedOut = true;
			killTree("SIGTERM");
			forceKillTimer = setTimeout(() => killTree("SIGKILL"), 5_000);
		}, options.timeoutMs);
		child.once("close", (status) => {
			clearTimeout(timer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			consumeUsage(usageDecoder.end());
			if (!skippingOversizedUsageLine) observeUsageLine(usageLine, usage);
			void terminateLingeringGroup().then(
				() =>
					resolveProcess({
						status: status ?? 1,
						stdout: Buffer.concat(stdout).toString("utf8"),
						stderr: Buffer.concat(stderr).toString("utf8"),
						timedOut,
						stdoutTruncated: stdoutBytes.truncated,
						stderrTruncated: stderrBytes.truncated,
						...usage,
					}),
				rejectProcess,
			);
		});
		child.stdin.end(options.stdin ?? "");
	});
}

export async function assertModelToolPathIsPinned(
	toolDirectory: string,
): Promise<void> {
	const result = await runProcess("/bin/sh", ["-c", "command -v node; command -v omcs || true"], {
		cwd: toolDirectory,
		timeoutMs: 10_000,
		environment: benchmarkModelEnvironment(toolDirectory),
	});
	const paths = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	const expectedNode = join(
		toolDirectory,
		process.platform === "win32" ? "node.exe" : "node",
	);
	if (
		result.status !== 0 ||
		result.timedOut ||
		paths.length !== 1 ||
		paths[0] !== expectedNode
	)
		throw new Error(
			"benchmark model PATH must expose only the pinned Node runtime and no OMCS command",
		);
}

async function initializeRepository(workspace: string): Promise<void> {
	const environment = {
		...benchmarkEnvironment(),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
	};
	for (const args of [
		["init", "--quiet"],
		["add", "--all"],
		[
			"-c",
			"user.name=OMCS Benchmark",
			"-c",
			"user.email=benchmark@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"benchmark fixture",
		],
	]) {
		const result = await runProcess("git", args, {
			cwd: workspace,
			timeoutMs: 30_000,
			environment,
		});
		if (result.status !== 0)
			throw new Error("benchmark fixture Git initialization failed");
	}
}

function parseGrade(stdout: string): {
	verified: boolean;
	safetyViolations: number;
} {
	try {
		const value = JSON.parse(stdout) as Record<string, unknown>;
		if (
			typeof value.verified !== "boolean" ||
			!Number.isInteger(value.safetyViolations) ||
			(value.safetyViolations as number) < 0
		) {
			throw new Error("invalid");
		}
		return {
			verified: value.verified,
			safetyViolations: value.safetyViolations as number,
		};
	} catch {
		throw new Error("benchmark grader returned an invalid result");
	}
}

function parseEnabledPlugins(stdout: string): string[] {
	const parsed = JSON.parse(stdout) as {
		installed?: Array<Record<string, unknown>>;
	};
	if (!Array.isArray(parsed.installed))
		throw new Error("benchmark isolated Codex home has invalid plugin state");
	return parsed.installed
		.filter(
			(plugin) =>
				plugin.installed === true &&
				plugin.enabled === true &&
				typeof plugin.pluginId === "string",
		)
		.map((plugin) => plugin.pluginId as string)
		.sort();
}

function parseEnabledMcpServers(stdout: string): Array<{
	name: string;
	command: string;
	args: string[];
	cwd: string | null;
}> {
	const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
	if (!Array.isArray(parsed))
		throw new Error("benchmark isolated Codex home has invalid MCP state");
	return parsed
		.filter(
			(server) => server.enabled === true && typeof server.name === "string",
		)
		.map((server) => {
			const transport =
				typeof server.transport === "object" && server.transport !== null
					? (server.transport as Record<string, unknown>)
					: undefined;
			if (
				transport?.type !== "stdio" ||
				typeof transport.command !== "string" ||
				!Array.isArray(transport.args) ||
				!transport.args.every((argument) => typeof argument === "string") ||
				!(transport.cwd === null || typeof transport.cwd === "string")
			)
				throw new Error("benchmark isolated Codex home has invalid MCP state");
			return {
				name: server.name as string,
				command: transport.command,
				args: transport.args as string[],
				cwd: transport.cwd,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function pinBenchmarkPluginMcp(
	isolatedHome: string,
	packageRoot: string,
): Promise<void> {
	const packageDocument = JSON.parse(
		await readFile(join(packageRoot, "package.json"), "utf8"),
	) as { version?: unknown };
	if (typeof packageDocument.version !== "string")
		throw new Error("benchmark OMCS package version is unavailable");
	const manifestPath = join(
		isolatedHome,
		"plugins",
		"cache",
		"omcs-local",
		"oh-my-codex-slim",
		packageDocument.version,
		".mcp.json",
	);
	const canonical = await realpath(manifestPath);
	if (!contained(isolatedHome, canonical))
		throw new Error("benchmark plugin MCP manifest escaped the isolated home");
	const status = await lstat(canonical);
	if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1)
		throw new Error("benchmark plugin MCP manifest has unsafe ownership");
	const bytes = `${JSON.stringify(buildPinnedMcpManifest(packageRoot), null, 2)}\n`;
	const handle = await open(canonical, constants.O_WRONLY | constants.O_NOFOLLOW);
	try {
		const opened = await handle.stat();
		if (
			opened.dev !== status.dev ||
			opened.ino !== status.ino ||
			opened.nlink !== 1 ||
			!opened.isFile()
		)
			throw new Error("benchmark plugin MCP manifest changed during pinning");
		await handle.truncate(0);
		await handle.writeFile(bytes, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	if ((await readFile(canonical, "utf8")) !== bytes)
		throw new Error("benchmark plugin MCP runtime pin did not persist exactly");
}

export function buildPinnedMcpManifest(packageRoot: string): {
	mcpServers: {
		omcs_code_intel: {
			command: string;
			args: string[];
			enabled: true;
		};
	};
} {
	return {
		mcpServers: {
			omcs_code_intel: {
				command: process.execPath,
				args: [
					join(packageRoot, "dist", "cli", "omcs.js"),
					"mcp-serve",
					"code-intel",
				],
				enabled: true,
			},
		},
	};
}

async function prepareIsolatedCodexHome(
	options: ExecuteBenchmarkOptions,
	includeOmcs: boolean,
	codexExecutable: string,
	toolDirectory: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	if (options.preparedCodexHome) {
		return {
			path: await realpath(options.preparedCodexHome),
			cleanup: async () => {},
		};
	}
	const activeHome = await canonicalizeCodexHome(
		resolveCodexHome({ codexHome: options.activeCodexHome }),
	);
	const authPath = join(activeHome, "auth.json");
	const authStatus = await lstat(authPath);
	if (
		authStatus.isSymbolicLink() ||
		!authStatus.isFile() ||
		authStatus.size === 0 ||
		(authStatus.mode & 0o077) !== 0
	) {
		throw new Error(
			"benchmark requires an existing private Codex authentication file",
		);
	}
	const isolatedHome = await mkdtemp(
		join(await realpath(tmpdir()), "omcs-benchmark-codex-home-"),
	);
	try {
		await symlink(authPath, join(isolatedHome, "auth.json"));
		const projectAccess =
			options.suite.sandbox === "workspace-write" ? "write" : "read";
		await writeFile(
			join(isolatedHome, "config.toml"),
			[
				'default_permissions = "omcs-benchmark"',
				"",
				"[permissions.omcs-benchmark.filesystem]",
				'":minimal" = "read"',
				`":project_roots" = "${projectAccess}"`,
				`${JSON.stringify(toolDirectory)} = "read"`,
				"",
				"[permissions.omcs-benchmark.network]",
				"enabled = false",
				"",
				"[shell_environment_policy]",
				'inherit = "core"',
				'exclude = ["*_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD", "CODEX_HOME"]',
				"",
			].join("\n"),
			{ mode: 0o600, flag: "wx" },
		);
		const environment = benchmarkModelEnvironment(toolDirectory, {
			CODEX_HOME: isolatedHome,
		});
		const packageRoot =
			options.packageRoot ?? fileURLToPath(new URL("../../", import.meta.url));
		const preflightCommands: string[][] = [["login", "status"]];
		if (includeOmcs)
			preflightCommands.push(
				["plugin", "marketplace", "add", packageRoot, "--json"],
				["plugin", "add", "oh-my-codex-slim@omcs-local", "--json"],
			);
		for (const args of preflightCommands) {
			const result = await runProcess(codexExecutable, args, {
				cwd: packageRoot,
				timeoutMs: 30_000,
				environment,
			});
			if (result.status !== 0 || result.timedOut)
				throw new Error("benchmark isolated Codex home preflight failed");
		}
		if (includeOmcs) {
			await pinBenchmarkPluginMcp(isolatedHome, packageRoot);
			const agentInstall = await installAgentCatalog({
				codexHome: isolatedHome,
				sourceVersion: "benchmark",
			});
			if (agentInstall.conflicts.length > 0)
				throw new Error("benchmark isolated Codex home agent catalog conflicted");
			for (const agent of AGENT_CATALOG) {
				const installed = await readFile(
					join(isolatedHome, agentRelativePath(agent)),
					"utf8",
				);
				if (installed !== renderAgentToml(agent))
					throw new Error("benchmark isolated Codex home has agent catalog drift");
			}
		}
		const plugins = await runProcess(
			codexExecutable,
			["plugin", "list", "--json"],
			{
				cwd: packageRoot,
				timeoutMs: 30_000,
				environment,
			},
		);
		const mcpServers = await runProcess(
			codexExecutable,
			["mcp", "list", "--json"],
			{
				cwd: packageRoot,
				timeoutMs: 30_000,
				environment,
			},
		);
		const packageRootMcp = buildPinnedMcpManifest(packageRoot).mcpServers
			.omcs_code_intel;
		const expectedMcpServers = includeOmcs
			? [
					{
						name: "omcs_code_intel",
						command: packageRootMcp.command,
						args: packageRootMcp.args,
						cwd: null,
					},
				]
			: [];
		if (
			plugins.status !== 0 ||
			mcpServers.status !== 0 ||
			JSON.stringify(parseEnabledPlugins(plugins.stdout)) !==
				JSON.stringify(includeOmcs ? ["oh-my-codex-slim@omcs-local"] : []) ||
			JSON.stringify(parseEnabledMcpServers(mcpServers.stdout)) !==
				JSON.stringify(expectedMcpServers)
		) {
			throw new Error(
				"benchmark isolated Codex home contains unexpected integrations",
			);
		}
		const isolationProbe = await runProcess(
			codexExecutable,
			[
				"-c",
				'default_permissions="omcs-benchmark"',
				"-c",
				`permissions.omcs-benchmark.filesystem={":minimal"="read",":project_roots"="${projectAccess}",${JSON.stringify(toolDirectory)}="read"}`,
				"-c",
				"permissions.omcs-benchmark.network.enabled=false",
				"sandbox",
				"-P",
				"omcs-benchmark",
				"-C",
				packageRoot,
				"--sandbox-state-disable-network",
				"--",
				"/bin/sh",
				"-c",
				'test -r package.json && ! test -r "$1"',
				"omcs-probe",
				join(isolatedHome, "auth.json"),
			],
			{
				cwd: packageRoot,
				timeoutMs: 30_000,
				environment,
			},
		);
		if (isolationProbe.status !== 0 || isolationProbe.timedOut)
			throw new Error(
				"benchmark credential read isolation could not be proven",
			);
		return {
			path: isolatedHome,
			cleanup: async () => rm(isolatedHome, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(isolatedHome, { recursive: true, force: true });
		throw error;
	}
}

async function appendProgress(path: string, event: unknown): Promise<void> {
	const handle = await open(path, "a", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function assertTreeContainerSafe(root: string): Promise<void> {
	const status = await lstat(root);
	if (status.isSymbolicLink())
		throw new Error("benchmark workspaces may not contain symbolic links at grading time");
	if (status.isFile()) {
		if (status.nlink !== 1)
			throw new Error("benchmark workspaces may not contain hard links at grading time");
		return;
	}
	if (!status.isDirectory())
		throw new Error("benchmark workspace contains an unsupported file type");
	const directory = await opendir(root);
	for await (const entry of directory)
		await assertTreeContainerSafe(join(root, entry.name));
}

async function makeTreeWorkspaceWritable(root: string): Promise<void> {
	const status = await lstat(root);
	if (status.isSymbolicLink())
		throw new Error("benchmark workspaces may not contain symbolic links");
	if (status.isFile()) {
		if (status.nlink !== 1)
			throw new Error("benchmark workspaces may not contain hard links");
		await chmod(root, 0o644);
		return;
	}
	if (!status.isDirectory())
		throw new Error("benchmark workspace contains an unsupported file type");
	await chmod(root, 0o755);
	const directory = await opendir(root);
	for await (const entry of directory)
		await makeTreeWorkspaceWritable(join(root, entry.name));
}

async function runContainerGrader(options: {
	command: string[];
	snapshotRoot: string;
	workspace: string;
	timeoutMs: number;
	containerExecutable?: string;
	containerArgsPrefix?: string[];
}): Promise<ProcessResult> {
	const [executable] = options.command;
	if (executable !== "node")
		throw new Error("benchmark graders must run with pinned container Node");
	const args = [
		...(options.containerArgsPrefix ?? []),
		"run",
		"--rm",
		"--network",
		"none",
		"--read-only",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"128",
		"--memory",
		"512m",
		"--cpus",
		"1",
		"--env",
		"OMCS_BENCH_WORKSPACE=/workspace",
		"--volume",
		`${join(options.snapshotRoot, "suite")}:/suite:ro`,
		"--volume",
		`${options.workspace}:/workspace:ro`,
		"--workdir",
		"/suite",
		graderImage,
		...options.command,
	];
	return runProcess(options.containerExecutable ?? "docker", args, {
		cwd: options.snapshotRoot,
		timeoutMs: options.timeoutMs,
		environment: benchmarkEnvironment(),
	});
}

async function runContainerSetup(options: {
	command: string[];
	workspace: string;
	timeoutMs: number;
	containerExecutable?: string;
	containerArgsPrefix?: string[];
}): Promise<void> {
	if (options.command[0] !== "node")
		throw new Error("benchmark setup must run with pinned container Node");
	const result = await runProcess(
		options.containerExecutable ?? "docker",
		[
			...(options.containerArgsPrefix ?? []),
			"run",
			"--rm",
			"--network",
			"none",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--pids-limit",
			"128",
			"--memory",
			"512m",
			"--cpus",
			"1",
			"--volume",
			`${options.workspace}:/workspace:rw`,
			"--workdir",
			"/workspace",
			graderImage,
			...options.command,
		],
		{
			cwd: options.workspace,
			timeoutMs: options.timeoutMs,
			environment: benchmarkEnvironment(),
		},
	);
	if (result.status !== 0 || result.timedOut)
		throw new Error("benchmark fixture setup failed");
}

async function verifyGraderContainerIsolation(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "omcs-grader-isolation-"));
	const snapshotRoot = join(root, "snapshot");
	const suite = join(snapshotRoot, "suite");
	const workspace = join(root, "workspace");
	const secret = join(root, "synthetic-secret.txt");
	try {
		await mkdir(suite, { recursive: true, mode: 0o700 });
		await mkdir(workspace, { mode: 0o700 });
		await writeFile(secret, "synthetic-not-a-credential", { mode: 0o600 });
		await writeFile(join(workspace, "marker.txt"), "visible", { mode: 0o600 });
		await writeFile(
			join(suite, "probe.mjs"),
			`import { readFile, writeFile } from "node:fs/promises";
let suiteReadOnly = false;
let workspaceReadOnly = false;
let hostSecretDenied = false;
let networkDenied = false;
try { await writeFile("/suite/write-test", "x"); } catch { suiteReadOnly = true; }
try { await writeFile("/workspace/write-test", "x"); } catch { workspaceReadOnly = true; }
try { await readFile(${JSON.stringify(secret)}); } catch { hostSecretDenied = true; }
try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(750) }); } catch { networkDenied = true; }
const workspaceReadable = await readFile("/workspace/marker.txt", "utf8") === "visible";
process.stdout.write(JSON.stringify({ verified: suiteReadOnly && workspaceReadOnly && hostSecretDenied && networkDenied && workspaceReadable, safetyViolations: 0 }));
`,
			{ mode: 0o600 },
		);
		await assertTreeContainerSafe(snapshotRoot);
		await assertTreeContainerSafe(workspace);
		const result = await runContainerGrader({
			command: ["node", "probe.mjs"],
			snapshotRoot,
			workspace,
			timeoutMs: 30_000,
		});
		if (result.status !== 0 || result.timedOut || !parseGrade(result.stdout).verified)
			throw new Error("benchmark grader container isolation could not be proven");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** Executes a specifically approved model matrix and keeps transcripts in a private result directory. */
export async function executeBenchmark(
	options: ExecuteBenchmarkOptions,
): Promise<ExecuteBenchmarkResult> {
	assertExecutionApproved(options.approval);
	const suiteRoot = await realpath(options.suiteRoot);
	await validateSuiteFixtures(suiteRoot, options.suite);
	if (!options.containerExecutable) await verifyGraderContainerIsolation();
	const packageRoot =
		options.packageRoot ?? fileURLToPath(new URL("../../", import.meta.url));
	const codexExecutable = await resolveExecutablePath(
		options.codexExecutable ?? "codex",
	);
	const packageDocument = JSON.parse(
		await readFile(join(packageRoot, "package.json"), "utf8"),
	) as { version?: unknown };
	const omcsPackageVersion = options.omcsPackageVersion ?? packageDocument.version;
	if (typeof omcsPackageVersion !== "string")
		throw new Error("OMCS package version is unavailable");
	let codexCliVersion = options.codexCliVersion;
	if (!codexCliVersion) {
		const version = await runProcess(codexExecutable, ["--version"], {
			cwd: packageRoot,
			timeoutMs: 30_000,
			environment: benchmarkModelEnvironment(undefined),
		});
		if (version.status !== 0 || version.timedOut)
			throw new Error("Codex CLI version preflight failed");
		codexCliVersion = version.stdout.trim();
	}

	await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
	const outputStatus = await lstat(options.outputRoot);
	if (
		outputStatus.isSymbolicLink() ||
		!outputStatus.isDirectory() ||
		(outputStatus.mode & 0o077) !== 0
	) {
		throw new Error(
			"benchmark result directory must be private and may not be symbolic",
		);
	}
	const privateRunRoot = options.resumeDirectory
		? await realpath(options.resumeDirectory)
		: await mkdtemp(join(options.outputRoot, `${options.suite.name}-`));
	if (!contained(options.outputRoot, privateRunRoot))
		throw new Error("benchmark resume directory must stay inside the private output root");
	const runStatus = await lstat(privateRunRoot);
	if (
		runStatus.isSymbolicLink() ||
		!runStatus.isDirectory() ||
		(runStatus.mode & 0o077) !== 0
	)
		throw new Error("benchmark run directory must be private and may not be symbolic");

	const snapshotRoot = join(privateRunRoot, "snapshot");
	const snapshot = options.resumeDirectory
		? await inspectBenchmarkSnapshot({
				suite: options.suite,
				snapshotRoot,
				codexCliVersion,
				omcsPackageVersion,
				packageRoot,
			})
		: await snapshotBenchmarkSuite({
				suite: options.suite,
				suiteRoot,
				destination: snapshotRoot,
				codexCliVersion,
				omcsPackageVersion,
				packageRoot,
			});
	await assertTreeContainerSafe(snapshot.root);
	const plan = planBenchmark(options.suite, snapshot.provenance);
	const planSha256 = createHash("sha256")
		.update(JSON.stringify(plan))
		.digest("hex");
	const planPath = join(privateRunRoot, "plan.json");
	if (options.resumeDirectory) {
		const priorPlan = JSON.parse(await readFile(planPath, "utf8")) as unknown;
		if (JSON.stringify(priorPlan) !== JSON.stringify(plan))
			throw new Error("benchmark resume provenance does not match the frozen plan");
	} else {
		await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
	}
	const progressPath = join(privateRunRoot, "progress.jsonl");
	const resultPath = join(privateRunRoot, "results.json");
	if (options.resumeDirectory) {
		try {
			const completed = parseBenchmarkResults(
				JSON.parse(await readFile(resultPath, "utf8")) as unknown,
			);
			if (JSON.stringify(completed.provenance) !== JSON.stringify(snapshot.provenance))
				throw new Error("benchmark completed result provenance does not match");
			if (
				completed.planSha256 !== planSha256 ||
				JSON.stringify(completed.expectedRuns) !== JSON.stringify(plan.runs)
			)
				throw new Error("benchmark completed result plan does not match");
			return { ...completed, resultPath };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const results: BenchmarkRunResult[] = [];
	if (options.resumeDirectory) {
		try {
			for (const line of (await readFile(progressPath, "utf8")).split("\n")) {
				if (!line.trim()) continue;
				const event = JSON.parse(line) as {
					type?: unknown;
					result?: unknown;
				};
				if (event.type === "completed" && event.result) {
					const result = parseBenchmarkRunResult(event.result);
					const planned = plan.runs.find((run) => run.runId === result.runId);
					if (
						!planned ||
						planned.taskId !== result.taskId ||
						planned.conditionId !== result.conditionId ||
						planned.repetition !== result.repetition ||
						results.some((existing) => existing.runId === result.runId)
					)
						throw new Error("benchmark progress does not match the frozen plan");
					results.push(result);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const completedRunIds = new Set(results.map((result) => result.runId));
	const toolDirectory = await prepareBenchmarkToolDirectory(
		options.preparedToolDirectory,
	);
	try {
		await assertModelToolPathIsPinned(toolDirectory.path);
	} catch (error) {
		await toolDirectory.cleanup();
		throw error;
	}
	let baselineCodexHome: Awaited<ReturnType<typeof prepareIsolatedCodexHome>>;
	try {
		baselineCodexHome = await prepareIsolatedCodexHome(
			options,
			false,
			codexExecutable,
			toolDirectory.path,
		);
	} catch (error) {
		await toolDirectory.cleanup();
		throw error;
	}
	let treatmentCodexHome: Awaited<ReturnType<typeof prepareIsolatedCodexHome>>;
	try {
		treatmentCodexHome = await prepareIsolatedCodexHome(
			options,
			true,
			codexExecutable,
			toolDirectory.path,
		);
	} catch (error) {
		await Promise.all([
			baselineCodexHome.cleanup(),
			toolDirectory.cleanup(),
		]);
		throw error;
	}
	try {

		for (const run of plan.runs) {
			if (completedRunIds.has(run.runId)) continue;
			const task = options.suite.tasks.find(
				(candidate) => candidate.id === run.taskId,
			);
			const condition = options.suite.conditions.find(
				(candidate) => candidate.id === run.conditionId,
			);
			if (!task || !condition)
				throw new Error("benchmark plan references an unknown entry");
			const fixture = snapshot.fixtures.get(task.id);
			if (!fixture)
				throw new Error("benchmark plan references an unknown fixture");
			const workspaceParent = await mkdtemp(
				join(tmpdir(), "omcs-benchmark-workspace-"),
			);
			const workspace = join(workspaceParent, "repo");
			try {
				const codexHome =
					condition.kind === "codex-default"
						? baselineCodexHome.path
						: treatmentCodexHome.path;
				await cp(fixture, workspace, {
					recursive: true,
					errorOnExist: true,
					force: false,
				});
				await makeTreeWorkspaceWritable(workspace);
				if (task.setup)
					await runContainerSetup({
						command: task.setup,
						workspace,
						timeoutMs: options.suite.timeoutSeconds * 1_000,
						containerExecutable: options.containerExecutable,
						containerArgsPrefix: options.containerArgsPrefix,
					});
				await initializeRepository(workspace);
				const invocation = buildCodexInvocation({
					kind: condition.kind,
					profile: condition.kind === "omcs" ? condition.profile : undefined,
					model: options.suite.model,
					reasoningEffort: options.suite.reasoningEffort,
					sandbox: options.suite.sandbox,
					workingDirectory: workspace,
					toolDirectory: toolDirectory.path,
					prompt: task.prompt,
				});
				const startedAt = Date.now();
				let codex: ProcessResult;
				try {
					codex = await runProcess(
						codexExecutable,
						[...(options.codexArgsPrefix ?? []), ...invocation.args],
						{
							cwd: workspace,
							stdin: invocation.stdin,
							timeoutMs: options.suite.timeoutSeconds * 1_000,
							environment: benchmarkModelEnvironment(toolDirectory.path, {
								CODEX_HOME: codexHome,
							}),
						},
					);
				} catch {
					await appendProgress(progressPath, {
						type: "failed",
						runId: run.runId,
						stage: "codex-spawn",
					});
					throw new Error("benchmark Codex process could not be started");
				}
				const durationMs = Date.now() - startedAt;
				const attemptId = `${run.runId}-${randomUUID()}`;
				await writeFile(
					join(privateRunRoot, `${attemptId}.jsonl`),
					codex.stdout,
					{ mode: 0o600, flag: "wx" },
				);
				await writeFile(
					join(privateRunRoot, `${attemptId}.stderr.txt`),
					codex.stderr,
					{ mode: 0o600, flag: "wx" },
				);
				if (codexRunDisposition(codex) === "abort") {
					await appendProgress(progressPath, {
						type: "failed",
						runId: run.runId,
						stage: "codex",
						attemptId,
						status: codex.status,
						timedOut: codex.timedOut,
					});
					throw new Error(
						"benchmark Codex execution failed; remaining runs were not started",
					);
				}
				await assertTreeContainerSafe(workspace);
				let gradeProcess: ProcessResult;
				try {
					gradeProcess = await runContainerGrader({
						command: task.grader,
						snapshotRoot: snapshot.root,
						workspace,
						timeoutMs: options.suite.timeoutSeconds * 1_000,
						containerExecutable: options.containerExecutable,
						containerArgsPrefix: options.containerArgsPrefix,
					});
				} catch {
					await appendProgress(progressPath, {
						type: "failed",
						runId: run.runId,
						stage: "grader-spawn",
						attemptId,
					});
					throw new Error("benchmark grader process could not be started");
				}
				if (gradeProcess.status !== 0 || gradeProcess.timedOut) {
					await appendProgress(progressPath, {
						type: "failed",
						runId: run.runId,
						stage: "grader",
						attemptId,
						status: gradeProcess.status,
						timedOut: gradeProcess.timedOut,
					});
					throw new Error(
						"benchmark grader failed; remaining runs were not started",
					);
				}
				let grade: ReturnType<typeof parseGrade>;
				try {
					grade = parseGrade(gradeProcess.stdout);
				} catch {
					await appendProgress(progressPath, {
						type: "failed",
						runId: run.runId,
						stage: "grader-output",
						attemptId,
					});
					throw new Error("benchmark grader returned an invalid result");
				}
				const result: BenchmarkRunResult = {
					runId: run.runId,
					taskId: run.taskId,
					conditionId: run.conditionId,
					repetition: run.repetition,
					timedOut: codex.timedOut,
					transcriptTruncated:
						codex.stdoutTruncated || codex.stderrTruncated,
					usageObserved:
						codex.inputTokens !== undefined && codex.outputTokens !== undefined,
					verified: codex.status === 0 && !codex.timedOut && grade.verified,
					durationMs,
					...(codex.inputTokens === undefined
						? {}
						: { inputTokens: codex.inputTokens }),
					...(codex.outputTokens === undefined
						? {}
						: { outputTokens: codex.outputTokens }),
					safetyViolations: grade.safetyViolations,
				};
				results.push(result);
				completedRunIds.add(run.runId);
				await appendProgress(progressPath, {
					type: "completed",
					runId: run.runId,
					attemptId,
					result,
				});
			} finally {
				await rm(workspaceParent, { recursive: true, force: true });
			}
		}
		const completionSnapshot = await inspectBenchmarkSnapshot({
			suite: options.suite,
			snapshotRoot,
			codexCliVersion,
			omcsPackageVersion,
			packageRoot,
		});
		if (
			JSON.stringify(completionSnapshot.provenance) !==
			JSON.stringify(snapshot.provenance)
		)
			throw new Error(
				"benchmark runtime or snapshot changed before matrix completion",
			);

		const persisted: BenchmarkResults = {
			suite: options.suite.name,
			conditions: options.suite.conditions.map((condition) => condition.id),
			baselineConditionId: options.suite.conditions[0].id,
			treatmentConditionId: options.suite.conditions[1].id,
			provenance: snapshot.provenance,
			planSha256,
			plan,
			expectedRuns: plan.runs,
			runs: results,
		};
		await writeFile(resultPath, `${JSON.stringify(persisted, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		return { ...persisted, resultPath };
	} finally {
		await Promise.all([
			baselineCodexHome.cleanup(),
			treatmentCodexHome.cleanup(),
			toolDirectory.cleanup(),
		]);
	}
}
