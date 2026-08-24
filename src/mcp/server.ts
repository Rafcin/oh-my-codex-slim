import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
	astReplace,
	astSearch,
	canonicalProjectRoot,
	type ToolResult,
} from "./ast.js";
import { buildCodeMap } from "./codemap.js";
import {
	languageServerConfigurationsFromEnvironment,
	runLanguageServerOperation,
	type LanguageServerConfigurations,
} from "./lsp.js";

export const TOOL_NAMES = [
	"omcs_ast_search",
	"omcs_ast_replace",
	"omcs_symbols",
	"omcs_references",
	"omcs_diagnostics",
	"omcs_codemap",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];
type ToolArguments = Record<string, unknown>;

interface ArgumentContract {
	required: readonly string[];
	optional: readonly string[];
	allowEmpty?: readonly string[];
	integers?: Readonly<Record<string, { minimum: number; maximum: number }>>;
	booleans?: readonly string[];
}

const ARGUMENT_CONTRACTS: Record<ToolName, ArgumentContract> = {
	omcs_ast_search: {
		required: ["root", "path", "pattern", "language"],
		optional: ["maxResults"],
		integers: { maxResults: { minimum: 1, maximum: 10_000 } },
	},
	omcs_ast_replace: {
		required: ["root", "path", "pattern", "replacement", "language"],
		optional: ["dryRun"],
		allowEmpty: ["replacement"],
		booleans: ["dryRun"],
	},
	omcs_symbols: { required: ["root", "path"], optional: [] },
	omcs_references: { required: ["root", "path", "symbol"], optional: [] },
	omcs_diagnostics: { required: ["root", "path"], optional: [] },
	omcs_codemap: {
		required: ["root"],
		optional: ["path", "maxFiles"],
		integers: { maxFiles: { minimum: 1, maximum: 10_000 } },
	},
};

const projectPathProperties = {
	root: {
		type: "string",
		minLength: 1,
		description: "Absolute or relative project root",
	},
	path: {
		type: "string",
		minLength: 1,
		description: "Path resolved within the canonical project root",
	},
} as const;

const TOOLS: readonly Tool[] = [
	{
		name: "omcs_ast_search",
		description:
			"Search source syntax with the project-pinned ast-grep executable.",
		inputSchema: {
			type: "object",
			properties: {
				...projectPathProperties,
				pattern: { type: "string", minLength: 1 },
				language: { type: "string", minLength: 1 },
				maxResults: { type: "integer", minimum: 1, maximum: 10_000 },
			},
			required: ["root", "path", "pattern", "language"],
			additionalProperties: false,
		},
	},
	{
		name: "omcs_ast_replace",
		description:
			"Preview or atomically apply one syntax replacement with an exact project backup.",
		inputSchema: {
			type: "object",
			properties: {
				...projectPathProperties,
				pattern: { type: "string", minLength: 1 },
				replacement: { type: "string" },
				language: { type: "string", minLength: 1 },
				dryRun: { type: "boolean", default: true },
			},
			required: ["root", "path", "pattern", "replacement", "language"],
			additionalProperties: false,
		},
	},
	...(["omcs_symbols", "omcs_references", "omcs_diagnostics"] as const).map(
		(name): Tool => ({
			name,
			description: `${name.slice("omcs_".length)} from an explicitly configured installed language-server adapter.`,
			inputSchema: {
				type: "object",
				properties:
					name === "omcs_references"
						? {
								...projectPathProperties,
								symbol: { type: "string", minLength: 1 },
							}
						: { ...projectPathProperties },
				required:
					name === "omcs_references"
						? ["root", "path", "symbol"]
						: ["root", "path"],
				additionalProperties: false,
			},
		}),
	),
	{
		name: "omcs_codemap",
		description:
			"Build a deterministic map of source files without following symbolic links.",
		inputSchema: {
			type: "object",
			properties: {
				...projectPathProperties,
				maxFiles: { type: "integer", minimum: 1, maximum: 10_000 },
			},
			required: ["root"],
			additionalProperties: false,
		},
	},
];

function stringArgument(args: ToolArguments, name: string): string | null {
	return typeof args[name] === "string" ? args[name] : null;
}

function invalidArguments(): ToolResult<never> {
	return {
		ok: false,
		error: {
			code: "invalid-arguments",
			message: "Tool arguments do not match the declared schema",
		},
	};
}

function validatedArguments(
	name: ToolName,
	value: unknown,
): ToolArguments | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const args = value as ToolArguments;
	const contract = ARGUMENT_CONTRACTS[name];
	const allowed = new Set([...contract.required, ...contract.optional]);
	if (Object.keys(args).some((key) => !allowed.has(key))) return null;
	for (const field of contract.required) {
		if (!(field in args)) return null;
	}
	const integerFields = new Set(Object.keys(contract.integers ?? {}));
	const booleanFields = new Set(contract.booleans ?? []);
	for (const [field, fieldValue] of Object.entries(args)) {
		if (integerFields.has(field)) {
			const bounds = contract.integers?.[field];
			if (
				!bounds ||
				typeof fieldValue !== "number" ||
				!Number.isInteger(fieldValue) ||
				fieldValue < bounds.minimum ||
				fieldValue > bounds.maximum
			)
				return null;
			continue;
		}
		if (booleanFields.has(field)) {
			if (typeof fieldValue !== "boolean") return null;
			continue;
		}
		if (typeof fieldValue !== "string") return null;
		if (
			!(contract.allowEmpty ?? []).includes(field) &&
			fieldValue.trim() === ""
		)
			return null;
	}
	return args;
}

export async function callCodeIntelTool(
	name: string,
	argumentValue: unknown,
	options: {
		languageServers?: LanguageServerConfigurations;
		allowedRoots?: readonly string[];
	} = {},
): Promise<ToolResult> {
	if (!(TOOL_NAMES as readonly string[]).includes(name)) {
		return {
			ok: false,
			error: {
				code: "unknown-tool",
				message: "Unknown OMCS code-intelligence tool",
			},
		};
	}
	const args = validatedArguments(name as ToolName, argumentValue);
	if (!args) return invalidArguments();
	const root = stringArgument(args, "root");
	if (!root) return invalidArguments();
	let authorizedRoot = root;
	if (options.allowedRoots) {
		try {
			const canonicalRequested = await canonicalProjectRoot(root);
			const canonicalAllowed = await Promise.all(
				options.allowedRoots.map((candidate) =>
					canonicalProjectRoot(candidate),
				),
			);
			if (!canonicalAllowed.includes(canonicalRequested)) {
				return {
					ok: false,
					error: {
						code: "project-root-not-authorized",
						message: "Requested project root is not authorized by the MCP host",
					},
				};
			}
			authorizedRoot = canonicalRequested;
		} catch {
			return {
				ok: false,
				error: {
					code: "project-root-not-authorized",
					message: "Requested project root is not authorized by the MCP host",
				},
			};
		}
	}
	const path = stringArgument(args, "path") ?? ".";
	switch (name as ToolName) {
		case "omcs_ast_search": {
			const pattern = stringArgument(args, "pattern");
			const language = stringArgument(args, "language");
			if (!pattern || !language) return invalidArguments();
			return await astSearch({
				root: authorizedRoot,
				path,
				pattern,
				language,
				maxResults:
					typeof args.maxResults === "number" ? args.maxResults : undefined,
			});
		}
		case "omcs_ast_replace": {
			const pattern = stringArgument(args, "pattern");
			const replacement = stringArgument(args, "replacement");
			const language = stringArgument(args, "language");
			if (!pattern || replacement === null || !language)
				return invalidArguments();
			return await astReplace({
				root: authorizedRoot,
				path,
				pattern,
				replacement,
				language,
				dryRun: args.dryRun === false ? false : true,
			});
		}
		case "omcs_symbols":
			return await runLanguageServerOperation(
				{ root: authorizedRoot, path, operation: "symbols" },
				options.languageServers ?? {},
			);
		case "omcs_references": {
			const symbol = stringArgument(args, "symbol");
			if (!symbol) return invalidArguments();
			return await runLanguageServerOperation(
				{ root: authorizedRoot, path, operation: "references", symbol },
				options.languageServers ?? {},
			);
		}
		case "omcs_diagnostics":
			return await runLanguageServerOperation(
				{ root: authorizedRoot, path, operation: "diagnostics" },
				options.languageServers ?? {},
			);
		case "omcs_codemap":
			return await buildCodeMap({
				root: authorizedRoot,
				path,
				maxFiles: typeof args.maxFiles === "number" ? args.maxFiles : undefined,
			});
		default:
			return {
				ok: false,
				error: {
					code: "unknown-tool",
					message: "Unknown OMCS code-intelligence tool",
				},
			};
	}
}

export function createCodeIntelServer(
	options: {
		languageServers?: LanguageServerConfigurations;
		allowedRoots?: readonly string[];
	} = {},
): Server {
	const server = new Server(
		{ name: "omcs_code_intel", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [...TOOLS],
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const result = await callCodeIntelTool(
			request.params.name,
			request.params.arguments ?? {},
			{
				...options,
				allowedRoots: options.allowedRoots ?? [process.cwd()],
			},
		);
		return {
			content: [{ type: "text" as const, text: JSON.stringify(result) }],
			isError: !result.ok,
		};
	});
	return server;
}

export async function startCodeIntelStdioServer(): Promise<void> {
	const server = createCodeIntelServer({
		languageServers: languageServerConfigurationsFromEnvironment(),
	});
	await server.connect(new StdioServerTransport());
}
