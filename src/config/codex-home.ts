import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export interface CodexHomeOptions {
	codexHome?: string;
	env?: NodeJS.ProcessEnv;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as { code?: unknown }).code === "ENOENT";
}

/** Resolves the only Codex home that a management command may inspect. */
export function resolveCodexHome(options: CodexHomeOptions = {}): string {
	const candidate = options.codexHome ?? options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
	return resolve(candidate);
}

/** Canonicalizes existing ancestors and rejects every symlink in the root path. */
export async function canonicalizeCodexHome(codexHome: string): Promise<string> {
	const requested = resolve(codexHome);
	const parsed = parse(requested);
	const components = relative(parsed.root, requested).split(sep).filter(Boolean);
	let current = parsed.root;
	for (let index = 0; index < components.length; index += 1) {
		current = join(current, components[index]);
		try {
			const stat = await lstat(current);
			if (stat.isSymbolicLink()) throw new Error(`OMCS refuses symlinked CODEX_HOME path: ${current}`);
			if (!stat.isDirectory()) throw new Error(`OMCS CODEX_HOME ancestor is not a directory: ${current}`);
		} catch (error) {
			if (!isMissing(error)) throw error;
			const parent = resolve(current, "..");
			return resolve(await realpath(parent), ...components.slice(index));
		}
	}
	return realpath(requested);
}

export function codexHomeRelativePath(codexHome: string, path: string): string | null {
	const root = resolve(codexHome);
	const candidate = resolve(path);
	const value = relative(root, candidate);
	if (value === "" || value.startsWith("..") || isAbsolute(value)) return null;
	return value.replaceAll("\\", "/");
}

/** OMCS owns its record file, the managed config block, and reserved agents only. */
export function isOmcsManagedRelativePath(path: string): boolean {
	return path === "config.toml" || /^agents\/omcs-[^/]+\.toml$/.test(path);
}
