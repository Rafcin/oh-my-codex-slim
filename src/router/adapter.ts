import { z } from "zod";

import { runRouterCommand } from "./commands.js";
import {
	RouterError,
	type RouterCapabilities,
	type RouterCommand,
	type RouterCommandRunner,
} from "./types.js";

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

const configStatusSchema = z.strictObject({
	mode: z.enum(["router", "native"]),
	model: z.string().nullable(),
	model_provider: z.string(),
	login_free: z.boolean(),
	login_free_managed: z.boolean(),
	provider_mode_state_present: z.boolean(),
	signed_routing: z.boolean(),
	signed_routing_managed: z.boolean(),
	signed_provider_state_present: z.boolean(),
	router_default_model: z.string().nullable(),
	router_default_managed: z.boolean(),
	openai_base_url: z.string().nullable(),
	model_catalog_json: z.string().nullable(),
	config_protected: z.boolean(),
});

const serviceStatusSchema = z.strictObject({
	installed: z.boolean(),
	loaded: z.boolean(),
	state: z.string(),
});

const activeRequestSchema = z.strictObject({
	id: z.string(),
	provider: z.string(),
	model: z.string().optional(),
	threadId: z.string().optional(),
	parentThreadId: z.string().optional(),
	sessionId: z.string().optional(),
	sessionName: z.string().optional(),
	agentName: z.string().optional(),
	agentNickname: z.string().optional(),
	isSubagent: z.boolean().optional(),
	startedAt: z.number().int().nonnegative(),
});

const activitySchema = z.strictObject({
	state: z.string(),
	active: z.array(activeRequestSchema),
	activeCount: z.number().int().nonnegative(),
	provider: z.string().optional(),
	model: z.string().optional(),
	sessionName: z.string().optional(),
});

const dependentServiceSchema = z.strictObject({
	reachable: z.boolean(),
	enabled: z.boolean().optional(),
});

const healthStatusSchema = z.strictObject({
	ok: z.boolean(),
	status: z.number().int().optional(),
	service: z.string().optional(),
	version: z.string().optional(),
	router: z.string().optional(),
	degraded: z.array(z.string()).optional(),
	error: z.string().optional(),
	activity: activitySchema,
	gateway: dependentServiceSchema.optional(),
	oauth: dependentServiceSchema.optional(),
	api: dependentServiceSchema.optional(),
});

const doctorSchema = z.strictObject({
	ok: z.boolean(),
	checks: z.array(
		z.strictObject({
			status: z.enum(["ok", "warn", "fail"]),
			name: z.string(),
			detail: z.string(),
			fix: z.string().optional(),
		}),
	),
});

const agentNameSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);

const legacySubagentsSchema = z.strictObject({
	version: z.literal(1),
	all: z.boolean(),
});

const autoPolicySchema = z.strictObject({
	version: z.literal(1),
	policies: z.array(
		z.strictObject({ kind: z.enum(["provider", "model", "family"]), value: z.string().min(1) }),
	),
	matchingSlugs: z.array(agentNameSchema),
	path: z.string().min(1),
});

const proofCheckSchema = z.strictObject({
	name: z.string(),
	ok: z.boolean(),
	status: z.number().int().optional(),
	detail: z.string().optional(),
});

const toolProbeSchema = z.strictObject({
	ok: z.boolean(),
	checks: z.array(proofCheckSchema),
	at: z.string(),
});

const spawnProofSchema = z.strictObject({
	ok: z.boolean(),
	status: z.union([z.string(), z.number()]).optional(),
	at: z.string().optional(),
	turns: z.number().int().positive().optional(),
	newInputTokens: z.number().int().positive().optional(),
});

const diagnosticProofSchema = z.strictObject({
	status: z.enum(["checking", "candidate", "experimental", "proven", "failed"]),
	startedAt: z.string().optional(),
	toolProbe: toolProbeSchema.optional(),
	spawn: spawnProofSchema.optional(),
	reason: z.string().optional(),
});

const modernSubagentsSchema = z.strictObject({
	version: z.literal(2),
	mode: z.enum(["all", "selected", "proven"]),
	enabled: z.array(agentNameSchema),
	disabled: z.array(agentNameSchema),
	all: z.boolean(),
	path: z.string().min(1),
	proofs: z.record(agentNameSchema, diagnosticProofSchema),
	efforts: z.record(z.string(), z.string()),
	autoPolicies: autoPolicySchema,
});

const subagentsSchema = z.discriminatedUnion("version", [
	legacySubagentsSchema,
	modernSubagentsSchema,
]);

function incompatible(detail: string): RouterError {
	return new RouterError("incompatible-router", detail);
}

function parseJson(raw: string, label: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw incompatible(`${label} output does not match the supported JSON contract`);
	}
}

function parseSchema<T>(schema: z.ZodType<T>, raw: string, label: string): T {
	const parsed = schema.safeParse(parseJson(raw, label));
	if (!parsed.success) throw incompatible(`${label} output does not match the supported JSON contract`);
	return parsed.data;
}

function parseStatus(raw: string): {
	config: z.infer<typeof configStatusSchema>;
	service: z.infer<typeof serviceStatusSchema>;
	health: z.infer<typeof healthStatusSchema>;
} {
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length !== 3) throw incompatible("status output does not match the supported JSON contract");
	return {
		config: parseSchema(configStatusSchema, lines[0], "status config"),
		service: parseSchema(serviceStatusSchema, lines[1], "status service"),
		health: parseSchema(healthStatusSchema, lines[2], "status health"),
	};
}

function unavailable(installed: boolean, version: string | null): RouterCapabilities {
	return {
		installed,
		healthy: false,
		version,
		subagentMode: "unavailable",
		enabledAgents: [],
		disabledAgents: [],
	};
}

function unique(values: readonly string[], label: string): string[] {
	if (new Set(values).size !== values.length) {
		throw incompatible(`${label} output contains duplicate agent identifiers`);
	}
	return [...values];
}

async function requireCommand(runner: RouterCommandRunner, command: RouterCommand): Promise<string> {
	const result = await runner(command);
	if (result.ok) return result.stdout;
	if (result.code === "router-timeout") throw new RouterError("router-timeout", result.message);
	throw incompatible(`${command} is not supported by the installed Codex Router`);
}

export interface ReadRouterCapabilitiesOptions {
	runner?: RouterCommandRunner;
}

export async function readRouterCapabilities(
	options: ReadRouterCapabilitiesOptions = {},
): Promise<RouterCapabilities> {
	const runner = options.runner ?? ((command) => runRouterCommand(command));
	const versionResult = await runner("version");
	if (!versionResult.ok) {
		if (versionResult.code === "missing-router") return unavailable(false, null);
		if (versionResult.code === "router-timeout") {
			throw new RouterError("router-timeout", versionResult.message);
		}
		return unavailable(true, null);
	}

	const versionText = versionResult.stdout.trim();
	const parsedVersion = versionSchema.safeParse(versionText);
	if (!parsedVersion.success) throw incompatible("version output does not match the supported contract");
	const version = parsedVersion.data;

	const statusResult = await runner("status");
	if (!statusResult.ok) {
		if (statusResult.code === "router-timeout") {
			throw new RouterError("router-timeout", statusResult.message);
		}
		if (statusResult.code === "unsupported-router-command") {
			throw incompatible("status is not supported by the installed Codex Router");
		}
		return unavailable(true, version);
	}
	const status = parseStatus(statusResult.stdout);
	if (!status.service.installed || !status.service.loaded || !status.health.ok) {
		return unavailable(true, version);
	}

	const doctorResult = await runner("doctor");
	if (!doctorResult.ok) {
		if (doctorResult.code === "router-timeout") {
			throw new RouterError("router-timeout", doctorResult.message);
		}
		if (doctorResult.code === "unsupported-router-command") {
			throw incompatible("doctor is not supported by the installed Codex Router");
		}
		return unavailable(true, version);
	}
	const doctor = parseSchema(doctorSchema, doctorResult.stdout, "doctor");
	if (!doctor.ok || doctor.checks.some((check) => check.status === "fail")) {
		return unavailable(true, version);
	}

	const subagents = parseSchema(
		subagentsSchema,
		await requireCommand(runner, "subagents"),
		"subagents",
	);
	if (subagents.version === 1) {
		return {
			installed: true,
			healthy: true,
			version,
			subagentMode: "v1-only",
			enabledAgents: [],
			disabledAgents: [],
		};
	}

	unique(subagents.enabled, "subagents");
	const disabledAgents = unique(subagents.disabled, "subagents");
	return {
		installed: true,
		healthy: true,
		version,
		subagentMode: subagents.mode,
		// The pinned CLI exposes selected candidates and legacy diagnostic proofs,
		// not the registry v2 certificate that authorizes a native subagent.
		// Validate the selection document above, but never promote it locally.
		enabledAgents: [],
		disabledAgents,
	};
}
