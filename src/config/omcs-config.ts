import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { readBoundedRegularFile } from "./safe-reader.js";

const MAX_CONFIG_BYTES = 64 * 1024;

export type ExecutionProfile = "auto" | "fast" | "thorough" | "council";
export type ApprovalPolicy = "material-decisions";
export type AdaptivePolicy = "adaptive";
export type ReviewPolicy = "risk-gated";
export type AntiSlopPolicy = "changed-files";
export type CouncilPolicy = "explicit-only";

export const OMCS_SCHEMA_URL = "https://raw.githubusercontent.com/Rafcin/oh-my-codex-slim/main/schema/omcs.schema.json";

export interface OmcsQualityConfig {
	clarification?: AdaptivePolicy;
	design?: AdaptivePolicy;
	tdd?: AdaptivePolicy;
	review?: ReviewPolicy;
	antiSlop?: AntiSlopPolicy;
}

export interface OmcsOrchestrationConfig {
	maxParallel?: 2;
	council?: CouncilPolicy;
}

export interface OmcsConfig {
	$schema?: typeof OMCS_SCHEMA_URL;
	version: 1;
	profile?: ExecutionProfile;
	approval?: ApprovalPolicy;
	quality?: OmcsQualityConfig;
	orchestration?: OmcsOrchestrationConfig;
}

export interface EffectiveOmcsConfig extends Required<Omit<OmcsConfig, "quality" | "orchestration">> {
	quality: Required<OmcsQualityConfig>;
	orchestration: Required<OmcsOrchestrationConfig>;
}

export const DEFAULT_OMCS_CONFIG: EffectiveOmcsConfig = {
	$schema: OMCS_SCHEMA_URL,
	version: 1,
	profile: "auto",
	approval: "material-decisions",
	quality: {
		clarification: "adaptive",
		design: "adaptive",
		tdd: "adaptive",
		review: "risk-gated",
		antiSlop: "changed-files",
	},
	orchestration: {
		maxParallel: 2,
		council: "explicit-only",
	},
};

export interface ResolveOmcsConfigInput {
	cwd: string;
	codexHome: string;
	session?: Omit<OmcsConfig, "version" | "$schema">;
}

export interface ResolvedOmcsConfig {
	effective: EffectiveOmcsConfig;
	sources: {
		defaults: true;
		global: string | null;
		project: string | null;
		session: boolean;
	};
}

const qualityConfigSchema = z.object({
	clarification: z.literal("adaptive").optional(),
	design: z.literal("adaptive").optional(),
	tdd: z.literal("adaptive").optional(),
	review: z.literal("risk-gated").optional(),
	antiSlop: z.literal("changed-files").optional(),
}).strict();

const orchestrationConfigSchema = z.object({
	maxParallel: z.literal(2).optional(),
	council: z.literal("explicit-only").optional(),
}).strict();

const omcsConfigSchema = z.object({
	$schema: z.literal(OMCS_SCHEMA_URL).optional(),
	version: z.literal(1),
	profile: z.enum(["auto", "fast", "thorough", "council"]).optional(),
	approval: z.literal("material-decisions").optional(),
	quality: qualityConfigSchema.optional(),
	orchestration: orchestrationConfigSchema.optional(),
}).strict();

const sessionConfigSchema = omcsConfigSchema.omit({ version: true, $schema: true });

function configurationError(label: string): Error {
	return new Error(`OMCS ${label} configuration is invalid`);
}

/** Parses a bounded version-one OMCS configuration without environment interpolation. */
export function parseOmcsConfig(bytes: Uint8Array, label: string): OmcsConfig {
	if (bytes.byteLength > MAX_CONFIG_BYTES) {
		throw new Error(`OMCS ${label} configuration exceeds the 64 KiB limit`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw configurationError(label);
	}

	const result = omcsConfigSchema.safeParse(parsed);
	if (!result.success) throw configurationError(label);
	return result.data;
}

async function lstatDirectory(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
	try {
		const state = await lstat(path);
		if (state.isSymbolicLink()) throw new Error(`OMCS refuses symlinked project discovery path: ${path}`);
		return state.isDirectory() ? state : null;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

/** Finds the project policy at the closest Git root without crossing the cwd filesystem. */
export async function findProjectConfig(cwd: string): Promise<string | null> {
	let current = resolve(cwd);
	const startingDirectory = await lstatDirectory(current);
	if (!startingDirectory) return null;
	const device = startingDirectory.dev;

	for (;;) {
		const directory = await lstatDirectory(current);
		if (!directory || directory.dev !== device) return null;

		const gitMarker = await lstat(join(current, ".git")).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		});
		if (gitMarker && !gitMarker.isSymbolicLink() && (gitMarker.isDirectory() || gitMarker.isFile())) {
			const configPath = join(current, "omcs.config.json");
			try {
				await lstat(configPath);
				return configPath;
			} catch (error) {
				if (typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				throw error;
			}
		}

		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

async function readConfig(path: string, label: string): Promise<OmcsConfig | null> {
	const bytes = await readBoundedRegularFile(path, { maxBytes: MAX_CONFIG_BYTES, label: `${label} configuration` });
	return bytes ? parseOmcsConfig(bytes, label) : null;
}

/** Resolves safe defaults, global preferences, project policy, then an in-memory session overlay. */
export async function resolveOmcsConfig(input: ResolveOmcsConfigInput): Promise<ResolvedOmcsConfig> {
	const globalPath = join(resolve(input.codexHome), "oh-my-codex-slim", "config.json");
	const projectPath = await findProjectConfig(input.cwd);
	const [global, project] = await Promise.all([
		readConfig(globalPath, "global"),
		projectPath ? readConfig(projectPath, "project") : Promise.resolve(null),
	]);
	const session = input.session === undefined ? undefined : sessionConfigSchema.parse(input.session);

	return {
		effective: {
			...DEFAULT_OMCS_CONFIG,
			...global,
			...project,
			...session,
			quality: {
				...DEFAULT_OMCS_CONFIG.quality,
				...global?.quality,
				...project?.quality,
				...session?.quality,
			},
			orchestration: {
				...DEFAULT_OMCS_CONFIG.orchestration,
				...global?.orchestration,
				...project?.orchestration,
				...session?.orchestration,
			},
		},
		sources: {
			defaults: true,
			global: global ? globalPath : null,
			project: project ? projectPath : null,
			session: session !== undefined,
		},
	};
}
