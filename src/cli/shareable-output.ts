import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ShareableOutputContext {
	cwd: string;
	codexHome: string;
	packageRoot: string;
}

function within(root: string, path: string): string | null {
	const fromRoot = relative(resolve(root), resolve(path));
	if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return null;
	return fromRoot.split(sep).join("/");
}

function symbolizePath(path: string, context: ShareableOutputContext): string {
	if (resolve(path) === resolve(join(context.packageRoot, ".agents", "plugins", "marketplace.json"))) {
		return "package:marketplace.json";
	}
	const fromCodexHome = within(context.codexHome, path);
	if (fromCodexHome) return `\${CODEX_HOME}/${fromCodexHome}`;
	if (basename(path) === "omcs.config.json") return "project:omcs.config.json";
	const fromProject = within(context.cwd, path);
	if (fromProject) return `project:${fromProject}`;
	const fromPackage = within(context.packageRoot, path);
	if (fromPackage) return `package:${fromPackage}`;
	return `local:${basename(path) || "path"}`;
}

/** Recursively removes host-specific absolute paths from shareable CLI reports. */
export function symbolizeShareableOutput(value: unknown, context: ShareableOutputContext): unknown {
	if (typeof value === "string") return isAbsolute(value) ? symbolizePath(value, context) : value;
	if (Array.isArray(value)) return value.map((entry) => symbolizeShareableOutput(entry, context));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, symbolizeShareableOutput(entry, context)]));
	}
	return value;
}
