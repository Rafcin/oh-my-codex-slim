import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { readRouterCapabilities } from "../router/adapter.js";
import { buildRouterEnvironment, redactRouterCredentials, runRouterCommand } from "../router/commands.js";

export type RouterLifecycleAction = "install" | "status" | "doctor" | "update" | "panel" | "capabilities";
export interface RouterLifecycleOptions {
	dryRun?: boolean;
	sourceRoot?: string;
	method?: "checkout" | "homebrew";
}
export interface RouterLifecycleDependencies {
	announce?: (line: string) => void;
	execute?: (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
}

interface RouterPlan { action: "install" | "update" | "panel"; dryRun: boolean; command: string[]; alternatives?: string[][]; note?: string; stdout?: string; stderr?: string }

async function defaultExecute(file: string, args: readonly string[], env: NodeJS.ProcessEnv) {
	return promisify(execFile)(file, [...args], { env, timeout: 65_000, maxBuffer: 256 * 1024 });
}

function rendered(command: readonly string[]): string {
	return command.map((part) => JSON.stringify(part)).join(" ");
}

export function routerLifecycle(action: "install" | "update" | "panel", options?: RouterLifecycleOptions, dependencies?: RouterLifecycleDependencies): Promise<RouterPlan>;
export function routerLifecycle(action: "status" | "doctor", options?: RouterLifecycleOptions, dependencies?: RouterLifecycleDependencies): ReturnType<typeof runRouterCommand>;
export function routerLifecycle(action: "capabilities", options?: RouterLifecycleOptions, dependencies?: RouterLifecycleDependencies): ReturnType<typeof readRouterCapabilities>;
export function routerLifecycle(action: RouterLifecycleAction, options?: RouterLifecycleOptions, dependencies?: RouterLifecycleDependencies): Promise<unknown>;
export async function routerLifecycle(
	action: RouterLifecycleAction,
	options: RouterLifecycleOptions = {},
	dependencies: RouterLifecycleDependencies = {},
): Promise<unknown> {
	if (action === "capabilities") return readRouterCapabilities();
	if (action === "status" || action === "doctor") return runRouterCommand(action);

	let command: string[];
	let alternatives: string[][] | undefined;
	if (action === "install") {
		const homebrew = ["brew", "tap", "duolahypercho/codex-router"];
		const homebrewInstall = ["brew", "install", "codex-router"];
		const guided = ["codex-router", "setup", "--guided"];
		const pinnedCheckout = ["/absolute/pinned/codex-router/install.sh", "--target", "codex", "--no-provider", "--no-discovery", "--no-tray"];
		alternatives = [homebrew, homebrewInstall, guided, pinnedCheckout];
		if (options.sourceRoot !== undefined) {
			if (!isAbsolute(options.sourceRoot)) throw new Error("Router source root must be absolute");
			command = [join(options.sourceRoot, "install.sh"), "--target", "codex", "--no-provider", "--no-discovery", "--no-tray"];
		} else command = homebrew;
		for (const candidate of [command, ...alternatives]) dependencies.announce?.(rendered(candidate));
		return { action, dryRun: true, command, alternatives, note: "Install plans are shown only; run an approved method explicitly and decline any model smoke test." };
	}

	command = options.method === "homebrew" && action === "update"
		? ["brew", "upgrade", "codex-router"]
		: ["codex-router", action];
	dependencies.announce?.(rendered(command));
	if (options.dryRun) return { action, dryRun: true, command };
	const [file, ...args] = command;
	const result = await (dependencies.execute ?? defaultExecute)(file, args, await buildRouterEnvironment());
	return { action, dryRun: false, command, stdout: redactRouterCredentials(result.stdout), stderr: redactRouterCredentials(result.stderr) };
}
