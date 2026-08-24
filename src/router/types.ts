export type RouterCommand = "version" | "status" | "doctor" | "subagents";

export type RouterCommandErrorCode =
	| "missing-router"
	| "router-command-failed"
	| "router-timeout"
	| "unsupported-router-command";

export type CommandResult =
	| { ok: true; stdout: string; stderr: string }
	| { ok: false; code: RouterCommandErrorCode; message: string };

export type RouterSubagentMode = "unavailable" | "v1-only" | "all" | "selected" | "proven";

export interface RouterCapabilities {
	installed: boolean;
	healthy: boolean;
	version: string | null;
	subagentMode: RouterSubagentMode;
	/** Proof-authoritative usable agents only; empty when the approved CLI cannot establish registry v2 authority. */
	enabledAgents: string[];
	/** Router selection exclusions, not an independently enumerated registry catalog. */
	disabledAgents: string[];
}

export interface RouterProcessOptions {
	timeout: number;
	maxBuffer: number;
	env: NodeJS.ProcessEnv;
	encoding: "utf8";
	windowsHide: true;
}

export type RouterProcessExecutor = (
	file: string,
	args: readonly string[],
	options: RouterProcessOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type RouterCommandRunner = (command: RouterCommand) => Promise<CommandResult>;

export class RouterError extends Error {
	readonly code: "incompatible-router" | "router-timeout";

	constructor(code: "incompatible-router" | "router-timeout", detail: string) {
		super(`${code}: ${detail}`);
		this.name = "RouterError";
		this.code = code;
	}
}
