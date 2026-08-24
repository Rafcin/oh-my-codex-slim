import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import {
	canonicalProjectRoot,
	captureProjectPath,
	errorResult,
	minimalChildEnvironment,
	revalidateProjectPath,
	type ChildProcessRunner,
	type ToolResult,
} from "./ast.js";

const runExecutable = promisify(execFile);
const defaultRunner: ChildProcessRunner = async (file, args, options) => {
	const result = await runExecutable(file, [...args], options);
	return { stdout: result.stdout, stderr: result.stderr };
};

export type LanguageServerOperation = "symbols" | "references" | "diagnostics";

export interface LanguageServerInput {
	root: string;
	operation: LanguageServerOperation;
	path: string;
	symbol?: string;
}

export interface LanguageServerConfiguration {
	executable: string;
	args?: readonly string[];
	protocol: "omcs-json-v1";
}

export type LanguageServerConfigurations = Partial<Record<LanguageServerOperation, LanguageServerConfiguration>>;

export function languageServerConfigurationsFromEnvironment(
	environment: Record<string, string | undefined> = process.env,
): LanguageServerConfigurations {
	const executable = environment.OMCS_LSP_ADAPTER_BIN?.trim();
	if (!executable || !isAbsolute(executable)) return {};
	let args: string[] = [];
	const rawArgs = environment.OMCS_LSP_ADAPTER_ARGS_JSON;
	if (rawArgs) {
		try {
			const parsed = JSON.parse(rawArgs) as unknown;
			if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) return {};
			args = parsed;
		} catch {
			return {};
		}
	}
	const configuration: LanguageServerConfiguration = { executable, args, protocol: "omcs-json-v1" };
	return { symbols: configuration, references: configuration, diagnostics: configuration };
}

async function configuredExecutable(configuration: LanguageServerConfiguration): Promise<string | null> {
	if (configuration.protocol !== "omcs-json-v1" || !isAbsolute(configuration.executable)) return null;
	try {
		const info = await lstat(configuration.executable);
		if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) return null;
		await access(configuration.executable, constants.X_OK);
		return await realpath(configuration.executable);
	} catch {
		return null;
	}
}

export async function runLanguageServerOperation(
	input: LanguageServerInput,
	configurations: LanguageServerConfigurations,
	dependencies: { run?: ChildProcessRunner } = {},
): Promise<ToolResult> {
	try {
		const root = await canonicalProjectRoot(input.root);
		const targetSnapshot = await captureProjectPath(root, input.path);
		const target = targetSnapshot.target;
		const configuration = configurations[input.operation];
		if (!configuration) {
			return {
				ok: false,
				error: {
					code: "language-server-unavailable",
					message: "No explicitly configured language server is available",
				},
			};
		}
		const executable = await configuredExecutable(configuration);
		if (!executable) {
			return {
				ok: false,
				error: {
					code: "language-server-unavailable",
					message: "The explicitly configured language server is unavailable",
				},
			};
		}
		const request = JSON.stringify({ operation: input.operation, root, path: target, symbol: input.symbol });
		await revalidateProjectPath(targetSnapshot);
		const { stdout } = await (dependencies.run ?? defaultRunner)(executable, [...(configuration.args ?? []), request], {
			cwd: root,
			timeout: 30_000,
			maxBuffer: 10 * 1024 * 1024,
			env: minimalChildEnvironment(),
		});
		await revalidateProjectPath(targetSnapshot);
		return { ok: true, data: JSON.parse(stdout) as unknown };
	} catch (error) {
		return errorResult(error, "language-server-failed");
	}
}
