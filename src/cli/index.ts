import { doctor } from "./doctor.js";
import {
	agentsLifecycle,
	type AgentsLifecycleAction,
} from "./agents-lifecycle.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";
import { configureOmcs, showEffectiveConfig, validateOmcsConfigFile } from "./config.js";

const HELP = `OMCS management CLI

Usage:
  omcs setup [--scope user|project] [--dry-run] [--json]
  omcs update [--dry-run] [--json]
  omcs doctor [--json]
	  omcs status [--json]
	  omcs agents install|check|list [--dry-run] [--json]
	  omcs uninstall [--dry-run] [--json]
	  omcs configure --scope project|global|session --profile auto|fast|thorough|council [--update] [--dry-run] [--json]
  omcs config show --effective [--json]
  omcs config validate [path] [--json]
`;

function writeResult(value: unknown, asJson: boolean): void {
	if (asJson) {
		process.stdout.write(`${JSON.stringify(value)}\n`);
		return;
	}
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function invalid(context: string): void {
	process.stderr.write(`omcs: invalid arguments for ${context}\n`);
	process.exitCode = 64;
}

function flags(
	options: string[],
	allowed: readonly string[],
): { json: boolean; dryRun: boolean } | null {
	const seen = new Set<string>();
	for (const option of options) {
		if (!allowed.includes(option) || seen.has(option)) return null;
		seen.add(option);
	}
	return { json: seen.has("--json"), dryRun: seen.has("--dry-run") };
}

export async function main(
	args: string[] = process.argv.slice(2),
): Promise<void> {
	const [command, ...options] = args;
	switch (command) {
		case undefined:
		case "--help":
		case "-h":
		case "help":
			if (options.length > 0) {
				invalid("help");
				return;
			}
			process.stdout.write(HELP);
			return;
		case "setup":
			{
				let scope: "user" | "project" | undefined;
				const remaining: string[] = [];
				let scopeSeen = false;
				for (let index = 0; index < options.length; index += 1) {
					if (options[index] !== "--scope") {
						remaining.push(options[index]!);
						continue;
					}
					if (scopeSeen) {
						invalid("setup");
						return;
					}
					scopeSeen = true;
					const value = options[index + 1];
					if (value !== "user" && value !== "project") {
						process.stderr.write("omcs: --scope expects user or project\n");
						process.exitCode = 64;
						return;
					}
					scope = value;
					index += 1;
				}
				const parsed = flags(remaining, ["--dry-run", "--json"]);
				if (!parsed) {
					invalid("setup");
					return;
				}
				writeResult(
					{
						command,
						dryRun: parsed.dryRun,
						...(await setup({ dryRun: parsed.dryRun, scope })),
					},
					parsed.json,
				);
			}
			return;
		case "update":
			{
				const parsed = flags(options, ["--dry-run", "--json"]);
				if (!parsed) {
					invalid("update");
					return;
				}
				writeResult(
					{
						command,
						dryRun: parsed.dryRun,
						...(await update({ dryRun: parsed.dryRun })),
					},
					parsed.json,
				);
			}
			return;
		case "configure": {
			let scope: "project" | "global" | "session" | undefined;
			let profile: "auto" | "fast" | "thorough" | "council" | undefined;
			const remaining: string[] = [];
			for (let index = 0; index < options.length; index += 1) {
				const option = options[index];
				if (option !== "--scope" && option !== "--profile") { remaining.push(option!); continue; }
				const value = options[index + 1];
				if (option === "--scope") {
					if (scope || !["project", "global", "session"].includes(value ?? "")) { invalid("configure"); return; }
					scope = value as "project" | "global" | "session";
				} else {
					if (profile || !["auto", "fast", "thorough", "council"].includes(value ?? "")) { invalid("configure"); return; }
					profile = value as "auto" | "fast" | "thorough" | "council";
				}
				index += 1;
			}
			const parsed = flags(remaining, ["--update", "--dry-run", "--json"]);
			if (!scope || !profile || !parsed || (scope === "session" && remaining.includes("--update"))) { invalid("configure"); return; }
			writeResult(await configureOmcs({ scope, profile, update: remaining.includes("--update"), dryRun: parsed.dryRun }), parsed.json);
			return;
		}
		case "config": {
			const [subcommand, ...configOptions] = options;
			if (subcommand === "show") {
				const parsed = flags(configOptions, ["--effective", "--json"]);
				if (!parsed || !configOptions.includes("--effective")) { invalid("config show"); return; }
				writeResult(await showEffectiveConfig(), parsed.json);
				return;
			}
			if (subcommand === "validate") {
				const positionals = configOptions.filter((option) => !option.startsWith("--"));
				const switches = configOptions.filter((option) => option.startsWith("--"));
				const parsed = flags(switches, ["--json"]);
				if (!parsed || positionals.length > 1) { invalid("config validate"); return; }
				writeResult(await validateOmcsConfigFile(positionals[0] ?? "omcs.config.json"), parsed.json);
				return;
			}
			invalid("config");
			return;
		}
		case "doctor":
			{
				const parsed = flags(options, ["--json"]);
				if (!parsed) {
					invalid("doctor");
					return;
				}
				const report = await doctor();
				writeResult(report, parsed.json);
				if (!report.ok) process.exitCode = 1;
			}
			return;
		case "status":
			{
				const parsed = flags(options, ["--json"]);
				if (!parsed) {
					invalid("status");
					return;
				}
				writeResult(await status(), parsed.json);
			}
			return;
		case "agents": {
			const [action, ...actionOptions] = options as [
				AgentsLifecycleAction | undefined,
				...string[],
			];
			if (!action || !["install", "check", "list"].includes(action)) {
				invalid("agents");
				return;
			}
			const parsed = flags(
				actionOptions,
				action === "install" ? ["--dry-run", "--json"] : ["--json"],
			);
			if (!parsed) {
				invalid(`agents ${action}`);
				return;
			}
			writeResult(
				await agentsLifecycle(action, { dryRun: parsed.dryRun }),
				parsed.json,
			);
			return;
		}
		case "uninstall":
			{
				const parsed = flags(options, ["--dry-run", "--json"]);
				if (!parsed) {
					invalid("uninstall");
					return;
				}
				writeResult(
					{
						command,
						dryRun: parsed.dryRun,
						...(await uninstall({ dryRun: parsed.dryRun })),
					},
					parsed.json,
				);
			}
			return;
		case "migrate": {
			process.stderr.write(
				"omcs: legacy OpenCodex-to-Router migration is repository-only; no Router runtime is shipped\n",
			);
			process.exitCode = 64;
			return;
		}
		case "mcp-serve":
			if (options.length !== 1 || options[0] !== "code-intel") {
				process.stderr.write("omcs: mcp-serve expects code-intel\n");
				process.exitCode = 64;
				return;
			}
			await (await import("../mcp/server.js")).startCodeIntelStdioServer();
			return;
		default:
			process.stderr.write("omcs: unknown command\n");
			process.exitCode = 64;
	}
}
