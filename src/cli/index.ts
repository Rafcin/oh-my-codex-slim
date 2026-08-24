import { doctor } from "./doctor.js";
import {
	agentsLifecycle,
	type AgentsLifecycleAction,
} from "./agents-lifecycle.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";

const HELP = `OMCS management CLI

Usage:
  omcs setup [--scope user|project] [--dry-run] [--json]
  omcs update [--dry-run] [--json]
  omcs doctor [--json]
  omcs status [--json]
  omcs agents install|check|list [--dry-run] [--json]
  omcs uninstall [--dry-run] [--json]
  omcs migrate opencodex --rollback MANIFEST [--json]
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
			const migration = await import("../router/migrate-opencodex.js");
			try {
				const request = migration.parseMigrationCliArgs(options);
				const asJson = options.includes("--json");
				if (request.kind === "rollback") {
					writeResult(
						await migration.rollbackOpenCodexMigration(request.manifestPath),
						asJson,
					);
					return;
				}
				process.stderr.write(
					"omcs: OpenCodex is the supported transport; new OpenCodex-to-Router migrations are disabled\n",
				);
				process.exitCode = 64;
			} catch {
				process.stderr.write(
					"omcs: OpenCodex migration refused; inspect the migration report and owned state\n",
				);
				process.exitCode = 1;
			}
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
