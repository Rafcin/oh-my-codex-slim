import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import { buildRouterEnvironment } from "./commands.js";

import {
	readMigrationManifest,
	type MigrationManifest,
	type MigrationPhase,
	type OpenCodexServiceState,
	type RouterIntegrationState,
	type RouterServiceState,
	writeMigrationManifest,
} from "./migration-manifest.js";

const MAX_COMMAND_OUTPUT = 256 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const OPENCODEX_MARKER = "# Auto-injected by opencodex";
const ROUTER_START_MARKERS = [
	"# BEGIN codex-router-managed",
	"# BEGIN codex-router-provider-managed",
	"# BEGIN codex-router-signed-provider-managed",
	"# BEGIN codex-router-agent-concurrency-managed",
	"# BEGIN codex-router-multi-agent-v2-managed",
] as const;

export interface MigrationCommandRequest {
	file: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	stdin?: undefined;
}

export interface MigrationCommandResult {
	stdout: string;
	stderr: string;
}

export type MigrationCommandExecutor = (request: MigrationCommandRequest) => Promise<MigrationCommandResult>;

export interface PlanOpenCodexMigrationOptions {
	codexHome: string;
	openCodexHome: string;
	dryRun: boolean;
	execute?: MigrationCommandExecutor;
	environment?: NodeJS.ProcessEnv;
}

export interface MigrationAction {
	kind: "backup-config" | "disable-opencodex" | "enable-router" | "verify-router";
	path?: string;
}

export interface MigrationPlan {
	readonly dryRun: boolean;
	readonly manifestPath: string;
	readonly actions: readonly Readonly<MigrationAction>[];
	readonly paths: Readonly<MigrationManifest["paths"]>;
	readonly digests: Readonly<Pick<MigrationManifest["digests"], "configBefore" | "catalog" | "native">>;
	readonly services: Readonly<MigrationManifest["services"]>;
	readonly providers: readonly string[];
	readonly credentialsReady: boolean;
}

export interface MigrationResult {
	phase: MigrationPhase;
	manifestPath: string;
}

export interface RollbackOpenCodexMigrationOptions {
	execute?: MigrationCommandExecutor;
	environment?: NodeJS.ProcessEnv;
	beforeFinalRestoreValidation?: () => Promise<void> | void;
	afterRestoreTargetOpened?: () => Promise<void> | void;
	afterConfigRestore?: () => Promise<void> | void;
	afterOptionalRemoveValidation?: (path: string) => Promise<void> | void;
}

export type MigrationCliRequest =
	| { kind: "apply"; dryRun: boolean }
	| { kind: "rollback"; manifestPath: string };

interface InternalPlan {
	publicPlan: MigrationPlan;
	execute: MigrationCommandExecutor;
	environments: MigrationEnvironments;
	proofKind: OwnershipProof["kind"];
}

interface MigrationEnvironments {
	router: NodeJS.ProcessEnv;
	openCodex: NodeJS.ProcessEnv;
}

interface InspectedInputs {
	codexHome: string;
	openCodexHome: string;
	configPath: string;
	config: Buffer;
	configDigest: string;
	catalogPath: string;
	catalogDigest: string;
	nativeDigest: string;
	nativeConfig: Buffer;
	providers: readonly string[];
	providerRequirements: readonly CatalogProviderRequirement[];
	ownership: OwnershipProof;
}

interface OwnershipMetadata {
	ownerPath: string;
	uninstallPath: string;
	ownerDigest: string;
	uninstallDigest: string;
}

interface IntegrationOwnershipProof extends OwnershipMetadata {
	kind: "integration";
	digest: string;
	bytes: Buffer;
}

interface LegacyJournalOwnershipProof extends OwnershipMetadata {
	kind: "journal-v1-opencodex-2.25.0";
	digest: string;
	bytes: Buffer;
	journalPath: string;
	journal: Buffer;
	journalDigest: string;
	journalAfterStop: Buffer | null;
	profilePath: string;
	profileBefore: Buffer | null;
	profileAfterStop: Buffer | null;
	injectedOpenaiBaseUrl: string;
}

type OwnershipProof = IntegrationOwnershipProof | LegacyJournalOwnershipProof;

interface RouterStatus {
	integration: RouterIntegrationState;
	service: RouterServiceState;
	healthy: boolean;
}

interface LiveState {
	openCodex: OpenCodexServiceState;
	router: RouterStatus;
}

interface FileObservation {
	bytes: Buffer;
	digest: string;
	dev: bigint;
	ino: bigint;
	mode: number;
	nlink: number;
	size: bigint;
	mtimeNs: bigint;
	ctimeNs: bigint;
}

class MigrationFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MigrationFailure";
	}
}

const planCapabilities = new WeakMap<MigrationPlan, InternalPlan>();

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function safeRegularFile(path: string, label: string, maxBytes = MAX_METADATA_BYTES): Promise<Buffer> {
	return (await observeRegularFile(path, label, maxBytes)).bytes;
}

function sameFileIdentity(
	left: Pick<FileObservation, "dev" | "ino" | "mode" | "nlink" | "size" | "mtimeNs" | "ctimeNs">,
	right: Pick<FileObservation, "dev" | "ino" | "mode" | "nlink" | "size" | "mtimeNs" | "ctimeNs">,
): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.mode === right.mode &&
		left.nlink === right.nlink &&
		left.size === right.size &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs
	);
}

async function observeRegularFile(
	path: string,
	label: string,
	maxBytes = MAX_CONFIG_BYTES,
	afterOpen?: () => Promise<void> | void,
	requiredNlink = 1,
): Promise<FileObservation> {
	const noFollow = (constants as unknown as Record<string, number>).O_NOFOLLOW ?? 0;
	let descriptor;
	try {
		descriptor = await open(path, constants.O_RDONLY | noFollow);
	} catch {
		throw new MigrationFailure(`${label} must be a bounded regular uniquely linked file and readable`);
	}
	try {
		await afterOpen?.();
		const before = await descriptor.stat({ bigint: true });
		if (!before.isFile() || before.nlink !== BigInt(requiredNlink) || before.size > BigInt(maxBytes)) {
			throw new MigrationFailure(`${label} must be a bounded regular uniquely linked file`);
		}
		const capacity = Math.min(maxBytes + 1, Number(before.size) + 1);
		const buffer = Buffer.alloc(capacity);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await descriptor.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		const after = await descriptor.stat({ bigint: true });
		const beforeIdentity = {
			dev: before.dev,
			ino: before.ino,
			mode: Number(before.mode),
			nlink: Number(before.nlink),
			size: before.size,
			mtimeNs: before.mtimeNs,
			ctimeNs: before.ctimeNs,
		};
		const afterIdentity = {
			dev: after.dev,
			ino: after.ino,
			mode: Number(after.mode),
			nlink: Number(after.nlink),
			size: after.size,
			mtimeNs: after.mtimeNs,
			ctimeNs: after.ctimeNs,
		};
		if (
			!after.isFile() ||
			after.nlink !== BigInt(requiredNlink) ||
			after.size > BigInt(maxBytes) ||
			offset !== Number(after.size) ||
			!sameFileIdentity(beforeIdentity, afterIdentity)
		) {
			throw new MigrationFailure(`${label} changed while it was being read`);
		}
		const bytes = buffer.subarray(0, offset);
		const observation = { bytes, digest: sha256(bytes), ...afterIdentity };
		await assertPathMatchesObservation(path, observation, label);
		return observation;
	} finally {
		await descriptor.close();
	}
}

async function observeOptionalRegularFile(
	path: string,
	label: string,
	maxBytes = MAX_METADATA_BYTES,
): Promise<FileObservation | null> {
	try {
		await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new MigrationFailure(`${label} could not be observed safely`);
	}
	return observeRegularFile(path, label, maxBytes);
}

function sameObservation(left: FileObservation, right: FileObservation): boolean {
	return left.digest === right.digest && sameFileIdentity(left, right);
}

function sameLinkedFileContent(left: FileObservation, right: FileObservation): boolean {
	return left.digest === right.digest
		&& left.dev === right.dev
		&& left.ino === right.ino
		&& left.mode === right.mode
		&& left.size === right.size
		&& left.mtimeNs === right.mtimeNs;
}

async function assertPathMatchesObservation(path: string, expected: FileObservation, label = "Codex config target"): Promise<void> {
	let information;
	try {
		information = await lstat(path, { bigint: true });
	} catch {
		throw new MigrationFailure(`${label} changed before final restore`);
	}
	const pathIdentity = {
		dev: information.dev,
		ino: information.ino,
		mode: Number(information.mode),
		nlink: Number(information.nlink),
		size: information.size,
		mtimeNs: information.mtimeNs,
		ctimeNs: information.ctimeNs,
	};
	if (information.isSymbolicLink() || !information.isFile() || !sameFileIdentity(pathIdentity, expected)) {
		throw new MigrationFailure(`${label} changed before final restore`);
	}
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
	if (!isAbsolute(path)) throw new MigrationFailure(`${label} must be absolute`);
	const requested = resolve(path);
	let information;
	try {
		information = await lstat(requested);
	} catch {
		throw new MigrationFailure(`${label} is missing or unreadable`);
	}
	if (!information.isDirectory() || information.isSymbolicLink()) throw new MigrationFailure(`${label} must be a real directory`);
	const canonical = await realpath(requested);
	if (canonical !== requested) throw new MigrationFailure(`${label} must be canonical`);
	return canonical;
}

function rootTomlString(content: string, key: string): string | undefined {
	const lines = content.split(/\r?\n/);
	const rootEnd = lines.findIndex((line) => /^\s*\[/.test(line));
	const rootLines = rootEnd === -1 ? lines : lines.slice(0, rootEnd);
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^\\s*${escaped}\\s*=\\s*("(?:\\\\.|[^"])*"|'[^']*')\\s*(?:#.*)?$`);
	for (const line of rootLines) {
		const match = pattern.exec(line);
		if (!match?.[1]) continue;
		try {
			return match[1].startsWith('"') ? (JSON.parse(match[1]) as string) : match[1].slice(1, -1);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function strictBase64(value: string, label: string, maxBytes: number): Buffer {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw new MigrationFailure(`${label} encoding is invalid`);
	}
	const bytes = Buffer.from(value, "base64");
	if (bytes.length > maxBytes || bytes.toString("base64") !== value) {
		throw new MigrationFailure(`${label} is invalid or oversized`);
	}
	return bytes;
}

function dominantEol(content: string): "\r\n" | "\n" {
	const crlf = (content.match(/\r\n/g) ?? []).length;
	const bareLf = (content.match(/\n/g) ?? []).length - crlf;
	return crlf > 0 && crlf >= bareLf ? "\r\n" : "\n";
}

function removeExactTable(content: string, header: string): string {
	const lines = content.split("\n");
	const output: string[] = [];
	let removing = false;
	for (const line of lines) {
		if (line.trim() === header) {
			removing = true;
			continue;
		}
		if (removing && /^\s*\[/.test(line)) removing = false;
		if (!removing) output.push(line);
	}
	return output.join("\n");
}

interface TomlSourceLine {
	text: string;
	eol: "\r\n" | "\n" | "";
	/** False when this physical line began inside a TOML multiline/container value. */
	structural: boolean;
}

type LegacySubagentKey = "default_subagent_model" | "default_subagent_reasoning_effort";

const LEGACY_SUBAGENT_KEYS: readonly LegacySubagentKey[] = [
	"default_subagent_model",
	"default_subagent_reasoning_effort",
];
const LEGACY_SUBAGENT_VALUE_MARKER = "# Managed by opencodex: native subagent default";
const LEGACY_SUBAGENT_TABLE_MARKER = "# Managed by opencodex: native subagent defaults table";

function splitTomlSourceLines(content: string): TomlSourceLine[] {
	const lines: TomlSourceLine[] = [];
	let offset = 0;
	while (offset < content.length) {
		const lf = content.indexOf("\n", offset);
		if (lf === -1) {
			lines.push({ text: content.slice(offset), eol: "", structural: true });
			break;
		}
		const crlf = lf > offset && content[lf - 1] === "\r";
		lines.push({
			text: content.slice(offset, crlf ? lf - 1 : lf),
			eol: crlf ? "\r\n" : "\n",
			structural: true,
		});
		offset = lf + 1;
	}
	markTomlStructuralLines(lines);
	return lines;
}

function markTomlStructuralLines(lines: TomlSourceLine[]): void {
	let multiline: "basic" | "literal" | null = null;
	let squareDepth = 0;
	let curlyDepth = 0;
	for (const line of lines) {
		line.structural = multiline === null && squareDepth === 0 && curlyDepth === 0;
		let single: "basic" | "literal" | null = null;
		for (let index = 0; index < line.text.length;) {
			if (multiline === "basic") {
				if (line.text.startsWith('\"\"\"', index)) {
					multiline = null;
					index += 3;
				} else if (line.text[index] === "\\") index += 2;
				else index += 1;
				continue;
			}
			if (multiline === "literal") {
				if (line.text.startsWith("'''", index)) {
					multiline = null;
					index += 3;
				} else index += 1;
				continue;
			}
			if (single === "basic") {
				if (line.text[index] === "\\") index += 2;
				else if (line.text[index] === '\"') {
					single = null;
					index += 1;
				} else index += 1;
				continue;
			}
			if (single === "literal") {
				if (line.text[index] === "'") single = null;
				index += 1;
				continue;
			}
			if (line.text[index] === "#") break;
			if (line.text.startsWith('\"\"\"', index)) {
				multiline = "basic";
				index += 3;
			} else if (line.text.startsWith("'''", index)) {
				multiline = "literal";
				index += 3;
			} else if (line.text[index] === '\"') {
				single = "basic";
				index += 1;
			} else if (line.text[index] === "'") {
				single = "literal";
				index += 1;
			} else if (line.text[index] === "[") {
				squareDepth += 1;
				index += 1;
			} else if (line.text[index] === "]") {
				squareDepth = Math.max(0, squareDepth - 1);
				index += 1;
			} else if (line.text[index] === "{") {
				curlyDepth += 1;
				index += 1;
			} else if (line.text[index] === "}") {
				curlyDepth = Math.max(0, curlyDepth - 1);
				index += 1;
			} else index += 1;
		}
	}
}

function joinTomlSourceLines(lines: readonly TomlSourceLine[]): string {
	return lines.map((line) => `${line.text}${line.eol}`).join("");
}

function decodeTomlBasicKey(body: string): string {
	return body.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (whole, escape: string) => {
		if (escape[0] === "x" || escape[0] === "u") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
		if (escape[0] === "U") {
			const codePoint = Number.parseInt(escape.slice(1), 16);
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
		}
		const escapes: Record<string, string> = {
			b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\",
		};
		return escapes[escape] ?? whole;
	});
}

function canonicalTomlKey(raw: string): string {
	if (raw.startsWith('"')) return decodeTomlBasicKey(raw.slice(1, -1));
	if (raw.startsWith("'")) return raw.slice(1, -1);
	return raw;
}

const TOML_KEY_SEGMENT = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const TOML_EXACT_TABLE_HEADER = new RegExp(`^\\s*\\[\\s*(${TOML_KEY_SEGMENT})\\s*\\]\\s*(?:#.*)?$`);
const TOML_ARRAY_TABLE_HEADER = new RegExp(`^\\s*\\[\\[\\s*(${TOML_KEY_SEGMENT})\\s*\\]\\]\\s*(?:#.*)?$`);
const TOML_DOTTED_TABLE_HEADER = new RegExp(`^\\s*\\[\\[?\\s*(${TOML_KEY_SEGMENT})\\s*\\.\\s*(${TOML_KEY_SEGMENT})(?:\\s*\\.|\\s*\\]\\]?)`);
const TOML_KEY_ASSIGNMENT = new RegExp(`^\\s*(${TOML_KEY_SEGMENT})\\s*=`);
const TOML_DOTTED_ASSIGNMENT = new RegExp(`^\\s*(${TOML_KEY_SEGMENT})\\s*\\.\\s*(${TOML_KEY_SEGMENT})(?:\\s*\\.|\\s*=)`);
const TOML_ANY_TABLE_HEADER = /^\s*\[{1,2}/;

function exactAgentsHeader(line: TomlSourceLine | undefined): boolean {
	if (!line?.structural) return false;
	const match = line.text.match(TOML_EXACT_TABLE_HEADER);
	return match !== null && canonicalTomlKey(match[1]!) === "agents";
}

function isAnyTomlTableHeader(line: TomlSourceLine): boolean {
	return line.structural && TOML_ANY_TABLE_HEADER.test(line.text);
}

function tomlAssignmentKey(line: TomlSourceLine | undefined): string | null {
	if (!line?.structural) return null;
	const match = line.text.match(TOML_KEY_ASSIGNMENT);
	return match ? canonicalTomlKey(match[1]!) : null;
}

function legacySubagentKey(line: TomlSourceLine | undefined): LegacySubagentKey | null {
	const key = tomlAssignmentKey(line);
	return LEGACY_SUBAGENT_KEYS.includes(key as LegacySubagentKey) ? key as LegacySubagentKey : null;
}

function structuralMarker(line: TomlSourceLine | undefined, marker: string): boolean {
	return line?.structural === true && line.text.trim() === marker;
}

interface LegacySubagentDefinition {
	key: LegacySubagentKey;
	index: number;
	owned: boolean;
}

interface LegacyAgentsShape {
	agentsHeader: number | null;
	agentsEnd: number | null;
	tableOwned: boolean;
	definitions: Map<LegacySubagentKey, LegacySubagentDefinition>;
}

function dottedTomlAssignment(line: TomlSourceLine): { first: string; second: string } | null {
	if (!line.structural) return null;
	const match = line.text.match(TOML_DOTTED_ASSIGNMENT);
	if (!match) return null;
	return { first: canonicalTomlKey(match[1]!), second: canonicalTomlKey(match[2]!) };
}

function analyzeLegacyAgentsToml(lines: readonly TomlSourceLine[]): LegacyAgentsShape {
	const exactHeaders: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (exactAgentsHeader(line)) exactHeaders.push(index);
		else if (line.structural) {
			const array = line.text.match(TOML_ARRAY_TABLE_HEADER);
			if (array && canonicalTomlKey(array[1]!) === "agents") {
				throw new MigrationFailure("array [[agents]] tables are not supported for managed subagent defaults");
			}
			const dotted = line.text.match(TOML_DOTTED_TABLE_HEADER);
			if (dotted && canonicalTomlKey(dotted[1]!) === "agents"
				&& LEGACY_SUBAGENT_KEYS.includes(canonicalTomlKey(dotted[2]!) as LegacySubagentKey)) {
				throw new MigrationFailure("agents default keys cannot be represented as nested tables");
			}
		}
	}
	if (exactHeaders.length > 1) {
		throw new MigrationFailure("duplicate [agents] tables cannot be updated safely");
	}

	const firstTable = lines.findIndex(isAnyTomlTableHeader);
	const rootEnd = firstTable === -1 ? lines.length : firstTable;
	for (let index = 0; index < rootEnd; index += 1) {
		const line = lines[index]!;
		const dotted = dottedTomlAssignment(line);
		if (dotted?.first === "agents" && LEGACY_SUBAGENT_KEYS.includes(dotted.second as LegacySubagentKey)) {
			throw new MigrationFailure("dotted agents default keys are not supported for managed subagent defaults");
		}
		if (tomlAssignmentKey(line) === "agents") {
			throw new MigrationFailure("inline agents definitions cannot be updated safely");
		}
	}

	const agentsHeader = exactHeaders[0] ?? null;
	let agentsEnd: number | null = null;
	const definitions = new Map<LegacySubagentKey, LegacySubagentDefinition>();
	if (agentsHeader !== null) {
		agentsEnd = lines.length;
		for (let index = agentsHeader + 1; index < lines.length; index += 1) {
			if (isAnyTomlTableHeader(lines[index]!)) {
				agentsEnd = index;
				break;
			}
			const dotted = dottedTomlAssignment(lines[index]!);
			if (dotted && LEGACY_SUBAGENT_KEYS.includes(dotted.first as LegacySubagentKey)) {
				throw new MigrationFailure(`dotted agents.${dotted.first} fields are not supported`);
			}
			const key = legacySubagentKey(lines[index]);
			if (!key) continue;
			if (definitions.has(key)) {
				throw new MigrationFailure(`duplicate agents.${key} definitions cannot be updated safely`);
			}
			definitions.set(key, {
				key,
				index,
				owned: structuralMarker(lines[index - 1], LEGACY_SUBAGENT_VALUE_MARKER),
			});
		}
	}

	for (let index = 0; index < lines.length; index += 1) {
		if (structuralMarker(lines[index], LEGACY_SUBAGENT_VALUE_MARKER)) {
			const nextKey = legacySubagentKey(lines[index + 1]);
			const insideAgents = agentsHeader !== null && agentsEnd !== null
				&& index > agentsHeader && index + 1 < agentsEnd;
			if (!nextKey || !insideAgents) {
				throw new MigrationFailure("orphaned managed subagent default marker cannot be updated safely");
			}
		}
		if (structuralMarker(lines[index], LEGACY_SUBAGENT_TABLE_MARKER) && index + 1 !== agentsHeader) {
			throw new MigrationFailure("orphaned managed agents table marker cannot be updated safely");
		}
	}

	return {
		agentsHeader,
		agentsEnd,
		tableOwned: agentsHeader !== null && structuralMarker(lines[agentsHeader - 1], LEGACY_SUBAGENT_TABLE_MARKER),
		definitions,
	};
}

function stripLegacyManagedSubagentDefaults(content: string): string {
	const lines = splitTomlSourceLines(content);
	if (!lines.some((line) => structuralMarker(line, LEGACY_SUBAGENT_VALUE_MARKER)
		|| structuralMarker(line, LEGACY_SUBAGENT_TABLE_MARKER))) return content;
	const shape = analyzeLegacyAgentsToml(lines);
	const removals: number[] = [];
	for (const key of LEGACY_SUBAGENT_KEYS) {
		const definition = shape.definitions.get(key);
		if (!definition?.owned) continue;
			const stringValue = `(?:"(?:\\\\.|[^"\\\\])*"|'[^']*')`;
			const source = lines[definition.index]!.text;
			const match = source.match(new RegExp(`^\\s*(${TOML_KEY_SEGMENT})\\s*=\\s*${stringValue}\\s*(?:#.*)?$`));
			if (!match || canonicalTomlKey(match[1]!) !== key) {
				throw new MigrationFailure(`OpenCodex managed agents.${key} is not a supported single-line TOML string`);
			}
			removals.push(definition.index - 1, definition.index);
	}
	const descending = removals.sort((left, right) => right - left);
	for (const index of descending) lines.splice(index, 1);
	if (shape.tableOwned) {
		const currentHeader = lines.findIndex(exactAgentsHeader);
		if (currentHeader === -1 || !structuralMarker(lines[currentHeader - 1], LEGACY_SUBAGENT_TABLE_MARKER)) {
			throw new MigrationFailure("OpenCodex managed agents table ownership changed during transform");
		}
		let currentEnd = lines.length;
		for (let index = currentHeader + 1; index < lines.length; index += 1) {
			if (isAnyTomlTableHeader(lines[index]!)) {
				currentEnd = index;
				break;
			}
		}
		if (lines.slice(currentHeader + 1, currentEnd).every((line) => line.text.trim() === "")) {
			lines.splice(currentHeader - 1, currentEnd - currentHeader + 1);
		} else {
			lines.splice(currentHeader - 1, 1);
		}
	}
	return joinTomlSourceLines(lines);
}

/**
 * Version-scoped compatibility transform for OpenCodex 2.25.0. The structural
 * `[agents]` ownership scanner/removal is adapted from the MIT-licensed
 * `@bitkyc08/opencodex` 2.25.0 `src/codex/subagent-defaults.ts`; see notices.
 */
function stripLegacyOpenCodex225(content: string, injectedUrl: string): Buffer {
	const eol = dominantEol(content);
	let output = content.replace(/\r\n/g, "\n");
	const lines = output.split("\n");
	const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
	const rootEnd = firstTable === -1 ? lines.length : firstTable;
	const drop = new Set<number>();
	let ownedBaseUrl = false;
	for (let index = 0; index < rootEnd; index += 1) {
		if (!/^\s*openai_base_url\s*=/.test(lines[index] ?? "")) continue;
		if (rootTomlString(lines[index] ?? "", "openai_base_url") !== injectedUrl) continue;
		ownedBaseUrl = true;
		drop.add(index);
		if (index > 0 && lines[index - 1]?.trim() === OPENCODEX_MARKER) drop.add(index - 1);
	}
	if (!ownedBaseUrl) throw new MigrationFailure("OpenCodex journal URL does not own the active routing value");
	output = lines.filter((_, index) => !drop.has(index)).join("\n");
	output = removeExactTable(output, "[model_providers.opencodex]");
	output = removeExactTable(output, "[profiles.opencodex]");
	const routedLines = output.split("\n");
	const routedFirstTable = routedLines.findIndex((line) => /^\s*\[/.test(line));
	output = routedLines.filter((line, index) => {
		if (/^\s*model_provider\s*=\s*"opencodex"\s*$/.test(line)) return false;
		if ((routedFirstTable === -1 || index < routedFirstTable) && /^\s*model\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*$/.test(line)) {
			const raw = line.match(/^\s*model\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*$/)?.[1];
			const value = raw?.startsWith('"') ? (() => { try { return JSON.parse(raw) as string; } catch { return raw.slice(1, -1); } })() : raw?.slice(1, -1);
			if (value?.includes("/")) return false;
		}
		const catalog = /^\s*model_catalog_json\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*$/.exec(line)?.[1];
		if (catalog) {
			const value = catalog.startsWith('"') ? (() => { try { return JSON.parse(catalog) as string; } catch { return catalog.slice(1, -1); } })() : catalog.slice(1, -1);
			if (value.replace(/\\/g, "/").split("/").pop() === "opencodex-catalog.json") return false;
		}
		return true;
	}).join("\n");
	output = stripLegacyManagedSubagentDefaults(output).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
	if (eol === "\r\n") output = output.replace(/\n/g, "\r\n");
	return Buffer.from(output);
}

function hasOpenCodexRouting(content: string): boolean {
	const lines = splitTomlSourceLines(content);
	let atRoot = true;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (isAnyTomlTableHeader(line)) atRoot = false;
		if (atRoot && tomlAssignmentKey(line) === "openai_base_url"
			&& structuralMarker(lines[index - 1], OPENCODEX_MARKER)) return true;
	}
	return false;
}

function routerManagedProjection(content: string): { hasCompleteBlock: boolean; projection: string } {
	const lines = splitTomlSourceLines(content);
	const output: string[] = [];
	let managedEnd: string | undefined;
	let hasCompleteBlock = false;
	let atRoot = true;
	for (const line of lines) {
		if (managedEnd) {
			if (line.structural && line.text.trim() === managedEnd) {
				managedEnd = undefined;
				hasCompleteBlock = true;
			} else if (line.structural && (ROUTER_START_MARKERS.some((marker) => line.text.trim() === marker)
				|| ROUTER_START_MARKERS.some((marker) => line.text.trim() === marker.replace("BEGIN", "END")))) {
				throw new MigrationFailure("Router managed block boundaries are incompatible");
			}
			continue;
		}
		const marker = line.structural
			? ROUTER_START_MARKERS.find((candidate) => line.text.trim() === candidate)
			: undefined;
		if (marker) {
			managedEnd = marker.replace("BEGIN", "END");
			continue;
		}
		if (line.structural && ROUTER_START_MARKERS.some((candidate) => line.text.trim() === candidate.replace("BEGIN", "END"))) {
			throw new MigrationFailure("Router managed block has an orphaned end marker");
		}
		if (isAnyTomlTableHeader(line)) atRoot = false;
		if (atRoot && structuralMarker(line, OPENCODEX_MARKER)) continue;
		const key = atRoot ? tomlAssignmentKey(line) : null;
		if (key === "openai_base_url" || key === "model_catalog_json") continue;
		output.push(line.text.trimEnd());
	}
	if (managedEnd) throw new MigrationFailure("Router managed block is unterminated");
	return {
		hasCompleteBlock,
		projection: `${output.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`,
	};
}

function hasRouterMarker(content: string): boolean {
	return routerManagedProjection(content).hasCompleteBlock;
}

function routerNeutralProjection(content: string): string {
	return routerManagedProjection(content).projection;
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const openCodexOwnerIdSchema = z.string().regex(
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const ownerSchema = z.object({ version: z.literal(1), ownerId: openCodexOwnerIdSchema, root: z.string() }).strict();
const uninstallSchema = ownerSchema.extend({ paths: z.array(z.string()).max(1024) }).strict();
const baselineSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("absent") }).passthrough(),
	z.object({ kind: z.literal("present"), sha256: digestSchema, bytesBase64: z.string() }).passthrough(),
]);
const provenanceEntrySchema = z.object({
	artifact: z.object({ kind: z.string(), canonicalPath: z.string().optional() }).passthrough(),
	baseline: baselineSchema,
	postImage: digestSchema.nullable(),
	txId: z.string(),
	at: z.string(),
}).passthrough();
const integrationRecordSchema = z.object({
	version: z.literal(1),
	provenance: z.object({ entries: z.array(provenanceEntrySchema) }).passthrough(),
}).passthrough();

const legacyJournalSchema = z.strictObject({
	version: z.literal(1),
	originalConfig: z.string().max(12 * 1024 * 1024),
	originalProfile: z.string().max(8 * 1024 * 1024).nullable(),
	injectedConfigHash: digestSchema,
	injectedProfileHash: digestSchema.nullable(),
	injectedOpenaiBaseUrl: z.string().min(1).max(2048),
	injectedCatalogPath: z.string().min(1).max(4096),
	pid: z.number().int().positive(),
	timestamp: z.string().datetime({ offset: true }),
});

async function readOwnershipMetadata(openCodexHome: string): Promise<OwnershipMetadata> {
	const ownerPath = join(openCodexHome, ".opencodex-owner.json");
	const uninstallPath = join(openCodexHome, ".opencodex-uninstall.json");
	let ownerObservation: FileObservation;
	let uninstallObservation: FileObservation;
	let owner: z.infer<typeof ownerSchema>;
	let uninstallRecord: z.infer<typeof uninstallSchema>;
	try {
		ownerObservation = await observeRegularFile(ownerPath, "OpenCodex ownership metadata");
		uninstallObservation = await observeRegularFile(uninstallPath, "OpenCodex uninstall ownership metadata");
		owner = ownerSchema.parse(JSON.parse(ownerObservation.bytes.toString("utf8")));
		uninstallRecord = uninstallSchema.parse(JSON.parse(uninstallObservation.bytes.toString("utf8")));
	} catch (error) {
		if (error instanceof MigrationFailure) throw error;
		throw new MigrationFailure("OpenCodex ownership metadata is missing or invalid");
	}
	if (owner.ownerId !== uninstallRecord.ownerId || owner.root !== openCodexHome || uninstallRecord.root !== openCodexHome) {
		throw new MigrationFailure("OpenCodex ownership does not match this data directory");
	}
	return {
		ownerPath,
		uninstallPath,
		ownerDigest: ownerObservation.digest,
		uninstallDigest: uninstallObservation.digest,
	};
}

async function proveIntegrationOwnership(
	openCodexHome: string,
	catalogPath: string,
	catalogDigest: string,
	configDigest: string,
): Promise<IntegrationOwnershipProof> {
	const metadata = await readOwnershipMetadata(openCodexHome);
	let integration: z.infer<typeof integrationRecordSchema>;
	try {
		integration = integrationRecordSchema.parse(JSON.parse((await safeRegularFile(join(openCodexHome, "integrations", "codex.json"), "OpenCodex catalog ownership metadata")).toString("utf8")));
	} catch (error) {
		if (error instanceof MigrationFailure) throw error;
		throw new MigrationFailure("OpenCodex ownership metadata is missing or invalid");
	}
	const catalogEntries = integration.provenance.entries.filter((entry) =>
		entry.artifact.kind === "active-catalog" && entry.artifact.canonicalPath === catalogPath && entry.postImage === catalogDigest,
	);
	if (catalogEntries.length !== 1) throw new MigrationFailure("OpenCodex catalog ownership could not be proven");
	const configEntries = integration.provenance.entries.filter((entry) => entry.artifact.kind === "config" && entry.postImage === configDigest);
	if (configEntries.length !== 1 || configEntries[0]?.baseline.kind !== "present") {
		throw new MigrationFailure("OpenCodex native config preimage could not be proven");
	}
	const nativeDigest = configEntries[0].baseline.sha256;
	if (nativeDigest === configDigest) throw new MigrationFailure("OpenCodex native config preimage is not distinct from injected routing");
	const encoded = configEntries[0].baseline.bytesBase64;
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
		throw new MigrationFailure("OpenCodex native config preimage encoding is invalid");
	}
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.length > MAX_CONFIG_BYTES || sha256(bytes) !== nativeDigest) {
		throw new MigrationFailure("OpenCodex native config preimage does not match its proven digest");
	}
	return { kind: "integration", digest: nativeDigest, bytes, ...metadata };
}

async function exactOpenCodex225Version(
	execute: MigrationCommandExecutor,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	const result = await executeSafely(execute, { file: "ocx", args: ["--version"], env }, "OpenCodex version proof");
	if (!/^opencodex 2\.25\.0\r?\n?$/.test(result.stdout)) {
		throw new MigrationFailure("OpenCodex legacy journal migration requires exact version 2.25.0");
	}
}

async function proveLegacyJournalOwnership(
	codexHome: string,
	openCodexHome: string,
	config: Buffer,
	configDigest: string,
	configuredCatalog: string,
	catalogPath: string,
	execute: MigrationCommandExecutor,
	openCodexEnvironment: NodeJS.ProcessEnv,
): Promise<LegacyJournalOwnershipProof> {
	await exactOpenCodex225Version(execute, openCodexEnvironment);
	const metadata = await readOwnershipMetadata(openCodexHome);
	const journalPath = join(codexHome, "opencodex-journal.json");
	const profilePath = join(codexHome, "opencodex.config.toml");
	let journalObservation: FileObservation;
	let journal: z.infer<typeof legacyJournalSchema>;
	try {
		journalObservation = await observeRegularFile(journalPath, "OpenCodex 2.25.0 journal", MAX_METADATA_BYTES);
		journal = legacyJournalSchema.parse(JSON.parse(journalObservation.bytes.toString("utf8")));
	} catch (error) {
		if (error instanceof MigrationFailure) throw error;
		throw new MigrationFailure("OpenCodex 2.25.0 journal is missing or malformed");
	}
	const activeBaseUrl = rootTomlString(config.toString("utf8"), "openai_base_url");
	if (activeBaseUrl !== journal.injectedOpenaiBaseUrl) {
		throw new MigrationFailure("OpenCodex journal URL does not match active routing");
	}
	if (configuredCatalog !== journal.injectedCatalogPath || resolve(codexHome, journal.injectedCatalogPath) !== catalogPath) {
		throw new MigrationFailure("OpenCodex journal catalog path does not match active routing");
	}
	const originalConfig = strictBase64(journal.originalConfig, "OpenCodex journal original config", MAX_CONFIG_BYTES);
	const originalProfile = journal.originalProfile === null
		? null
		: strictBase64(journal.originalProfile, "OpenCodex journal original profile", MAX_METADATA_BYTES);
	const profileObservation = await observeOptionalRegularFile(profilePath, "OpenCodex profile", MAX_METADATA_BYTES);
	const profileDigest = profileObservation?.digest ?? null;
	const configUnchanged = configDigest === journal.injectedConfigHash;
	const profileUnchanged = profileDigest === journal.injectedProfileHash;
	const nativeConfig = configUnchanged
		? originalConfig
		: stripLegacyOpenCodex225(config.toString("utf8"), journal.injectedOpenaiBaseUrl);
	if (nativeConfig.equals(config) || hasOpenCodexRouting(nativeConfig.toString("utf8"))) {
		throw new MigrationFailure("OpenCodex journal did not yield a distinct native config");
	}
	return {
		kind: "journal-v1-opencodex-2.25.0",
		digest: sha256(nativeConfig),
		bytes: nativeConfig,
		...metadata,
		journalPath,
		journal: journalObservation.bytes,
		journalDigest: journalObservation.digest,
		journalAfterStop: configUnchanged && profileUnchanged ? null : journalObservation.bytes,
		profilePath,
		profileBefore: profileObservation?.bytes ?? null,
		profileAfterStop: profileUnchanged ? originalProfile : (profileObservation?.bytes ?? null),
		injectedOpenaiBaseUrl: journal.injectedOpenaiBaseUrl,
	};
}

const catalogSchema = z.object({
	models: z.array(z.object({ slug: z.string().min(1).max(512) }).passthrough()).max(100_000),
}).passthrough();
const providerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

interface CatalogProviderRequirement {
	id: string;
	models: readonly string[];
}

function catalogProviderRequirements(catalog: Buffer): readonly CatalogProviderRequirement[] {
	let parsed: z.infer<typeof catalogSchema>;
	try {
		parsed = catalogSchema.parse(JSON.parse(catalog.toString("utf8")));
	} catch {
		throw new MigrationFailure("OpenCodex catalog has an incompatible provider-model shape");
	}
	const providers = new Map<string, string[]>();
	for (const model of parsed.models) {
		const separator = model.slug.indexOf("/");
		if (separator <= 0) continue;
		const provider = model.slug.slice(0, separator);
		if (!providerIdSchema.safeParse(provider).success) throw new MigrationFailure("OpenCodex catalog contains an unsafe provider name");
		if (!new Set(["native", "combo"]).has(provider.toLowerCase())) {
			const models = providers.get(provider) ?? [];
			models.push(model.slug.slice(separator + 1));
			providers.set(provider, models);
		}
	}
	return [...providers.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, models]) => ({ id, models: Object.freeze([...models]) }));
}

async function integrationRecordExists(openCodexHome: string): Promise<boolean> {
	try {
		await lstat(join(openCodexHome, "integrations", "codex.json"));
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw new MigrationFailure("OpenCodex integration provenance could not be inspected safely");
	}
}

async function inspectInputs(
	options: Pick<PlanOpenCodexMigrationOptions, "codexHome" | "openCodexHome">,
	legacyBoundary?: { execute: MigrationCommandExecutor; openCodexEnvironment: NodeJS.ProcessEnv },
): Promise<InspectedInputs> {
	const codexHome = await canonicalDirectory(options.codexHome, "Codex home");
	const openCodexHome = await canonicalDirectory(options.openCodexHome, "OpenCodex home");
	const configPath = join(codexHome, "config.toml");
	const config = await safeRegularFile(configPath, "Codex config", MAX_CONFIG_BYTES);
	const configText = config.toString("utf8");
	const configuredCatalog = rootTomlString(configText, "model_catalog_json");
	if (!configuredCatalog) throw new MigrationFailure("OpenCodex catalog ownership path is missing");
	const catalogPath = isAbsolute(configuredCatalog) ? resolve(configuredCatalog) : resolve(codexHome, configuredCatalog);
	const catalog = await safeRegularFile(catalogPath, "OpenCodex catalog", MAX_CATALOG_BYTES);
	if ((await realpath(catalogPath)) !== catalogPath) throw new MigrationFailure("OpenCodex catalog must be a bounded regular uniquely linked canonical file");
	const configDigest = sha256(config);
	const catalogDigest = sha256(catalog);
	let native: OwnershipProof;
	if (await integrationRecordExists(openCodexHome)) {
		if (!hasOpenCodexRouting(configText)) throw new MigrationFailure("OpenCodex ownership is unknown in the active Codex config");
		native = await proveIntegrationOwnership(openCodexHome, catalogPath, catalogDigest, configDigest);
	} else {
		if (!legacyBoundary) throw new MigrationFailure("OpenCodex legacy journal proof requires the exact version boundary");
		native = await proveLegacyJournalOwnership(
			codexHome,
			openCodexHome,
			config,
			configDigest,
			configuredCatalog,
			catalogPath,
			legacyBoundary.execute,
			legacyBoundary.openCodexEnvironment,
		);
	}
	const providerRequirements = catalogProviderRequirements(catalog);
	return {
		codexHome,
		openCodexHome,
		configPath,
		config,
		configDigest,
		catalogPath,
		catalogDigest,
		nativeDigest: native.digest,
		nativeConfig: native.bytes,
		providers: providerRequirements.map((requirement) => requirement.id),
		providerRequirements,
		ownership: native,
	};
}

async function migrationEnvironments(
	codexHome: string,
	openCodexHome: string,
	source: NodeJS.ProcessEnv = process.env,
): Promise<MigrationEnvironments> {
	const router = await buildRouterEnvironment({ ...source, CODEX_HOME: codexHome });
	const openCodex: NodeJS.ProcessEnv = {
		LANG: "C",
		LC_ALL: "C",
		PATH: router.PATH,
		CODEX_HOME: codexHome,
		OPENCODEX_HOME: openCodexHome,
	};
	return { router: Object.freeze({ ...router }), openCodex: Object.freeze(openCodex) };
}

const defaultExecutor: MigrationCommandExecutor = async (request) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(request.file, [...request.args], {
			env: request.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			shell: false,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const timeout = setTimeout(() => child.kill("SIGKILL"), COMMAND_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			if (stdoutBytes >= MAX_COMMAND_OUTPUT) return;
			const bounded = chunk.subarray(0, MAX_COMMAND_OUTPUT - stdoutBytes);
			stdout.push(bounded);
			stdoutBytes += bounded.length;
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderrBytes >= MAX_COMMAND_OUTPUT) return;
			const bounded = chunk.subarray(0, MAX_COMMAND_OUTPUT - stderrBytes);
			stderr.push(bounded);
			stderrBytes += bounded.length;
		});
		child.once("error", () => {
			clearTimeout(timeout);
			rejectPromise(new Error("Migration command could not be started"));
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (code !== 0) return rejectPromise(new Error("Migration command returned a nonzero status"));
			resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
		});
	});

async function executeSafely(
	execute: MigrationCommandExecutor,
	request: MigrationCommandRequest,
	label: string,
): Promise<MigrationCommandResult> {
	try {
		return await execute(request);
	} catch {
		throw new MigrationFailure(`${label} failed; inspect the owning tool without exposing its output`);
	}
}

async function detectOpenCodexServiceState(execute: MigrationCommandExecutor, env: NodeJS.ProcessEnv): Promise<OpenCodexServiceState> {
	const result = await executeSafely(execute, { file: "ocx", args: ["service", "status"], env }, "OpenCodex service status");
	if (/^✅[^\n]*\n\s*Serving on port \d{1,5}\./u.test(result.stdout)) return "running";
	if (/^(?:⚠️|❌)[^\n]*(?:installed, not loaded|installed, but not running|Task Scheduler disabled|native \(WinSW [^)]+\): stopped)/u.test(result.stdout)) return "stopped";
	throw new MigrationFailure("OpenCodex service state is unknown; migration stopped");
}

const routerConfigStatusSchema = z.strictObject({
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
const routerServiceStatusSchema = z.strictObject({ installed: z.boolean(), loaded: z.boolean(), state: z.string() });
const routerActivitySchema = z.object({ state: z.string(), active: z.array(z.unknown()), activeCount: z.number().int().nonnegative() }).passthrough();
const routerHealthSchema = z.object({ ok: z.boolean(), activity: routerActivitySchema }).passthrough();

async function readRouterStatus(execute: MigrationCommandExecutor, env: NodeJS.ProcessEnv): Promise<RouterStatus> {
	const result = await executeSafely(execute, { file: "codex-router", args: ["status"], env }, "Router status");
	const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim());
	if (lines.length !== 3) throw new MigrationFailure("Router status has an incompatible contract");
	try {
		const config = routerConfigStatusSchema.parse(JSON.parse(lines[0]!));
		const service = routerServiceStatusSchema.parse(JSON.parse(lines[1]!));
		const health = routerHealthSchema.parse(JSON.parse(lines[2]!));
		return {
			integration: config.mode === "router" ? "enabled" : "disabled",
			service: service.installed && service.loaded && service.state.toLowerCase() === "running" ? "running" : "stopped",
			healthy: health.ok,
		};
	} catch {
		throw new MigrationFailure("Router status has an incompatible contract");
	}
}

const routerProvidersSchema = z.strictObject({
	providers: z.array(z.strictObject({ id: providerIdSchema, name: z.string().min(1).max(256), visible: z.boolean(), configured: z.boolean() })),
});

interface ProviderProof {
	providers: readonly string[];
	ready: boolean;
}

function isFreeZenCatalog(requirement: CatalogProviderRequirement): boolean {
	return requirement.models.every((model) => model === "big-pickle" || model.endsWith("-free"));
}

async function readProviderProof(
	execute: MigrationCommandExecutor,
	env: NodeJS.ProcessEnv,
	openCodexProviders: readonly CatalogProviderRequirement[],
): Promise<ProviderProof> {
	const result = await executeSafely(
		execute,
		{ file: "codex-router", args: ["providers", "list", "--json"], env },
		"Router provider proof",
	);
	let document: z.infer<typeof routerProvidersSchema>;
	try {
		document = routerProvidersSchema.parse(JSON.parse(result.stdout));
	} catch {
		throw new MigrationFailure("Router provider proof has an incompatible contract");
	}
	if (new Set(document.providers.map((provider) => provider.id)).size !== document.providers.length) {
		throw new MigrationFailure("Router provider proof contains duplicate provider identities");
	}
	const visible = document.providers.filter((provider) => provider.visible);
	const ready = openCodexProviders.length > 0 && openCodexProviders.every((source) => {
		return visible.some((provider) => provider.configured && (
			provider.id === source.id
			|| (source.id === "opencode-zen" && isFreeZenCatalog(source) && provider.id === "opencode-free")
		));
	});
	return { providers: openCodexProviders.map((provider) => provider.id), ready };
}

const doctorSchema = z.strictObject({
	ok: z.boolean(),
	checks: z.array(z.strictObject({ status: z.enum(["ok", "warn", "fail"]), name: z.string(), detail: z.string(), fix: z.string().optional() })),
});

async function verifyRouterDoctor(execute: MigrationCommandExecutor, env: NodeJS.ProcessEnv): Promise<void> {
	const result = await executeSafely(execute, { file: "codex-router", args: ["doctor", "--json"], env }, "Router doctor");
	try {
		const doctor = doctorSchema.parse(JSON.parse(result.stdout));
		if (!doctor.ok || doctor.checks.some((check) => check.status === "fail")) throw new MigrationFailure("Router verification failed without exposing doctor output");
	} catch (error) {
		if (error instanceof MigrationFailure) throw error;
		throw new MigrationFailure("Router verification returned an incompatible document");
	}
}

async function readLiveState(execute: MigrationCommandExecutor, environments: MigrationEnvironments): Promise<LiveState> {
	return {
		openCodex: await detectOpenCodexServiceState(execute, environments.openCodex),
		router: await readRouterStatus(execute, environments.router),
	};
}

function assertCanonicalRouterPrestate(live: LiveState): void {
	if (live.router.service !== "running" || !live.router.healthy) throw new MigrationFailure("Router service must be installed, running, and healthy before migration");
	if (live.router.integration !== "disabled") throw new MigrationFailure("Router Codex integration is already enabled over OpenCodex routing");
}

function freezePlan(plan: MigrationPlan): MigrationPlan {
	for (const action of plan.actions) Object.freeze(action);
	Object.freeze(plan.actions);
	Object.freeze(plan.paths);
	Object.freeze(plan.digests);
	Object.freeze(plan.services);
	Object.freeze(plan.providers);
	return Object.freeze(plan);
}

export function defaultMigrationHomes(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir(),
): { codexHome: string; openCodexHome: string } {
	return {
		codexHome: resolve(env.CODEX_HOME?.trim() || join(userHome, ".codex")),
		openCodexHome: resolve(env.OPENCODEX_HOME?.trim() || join(userHome, ".opencodex")),
	};
}

export function parseMigrationCliArgs(args: readonly string[]): MigrationCliRequest {
	if (args[0] !== "opencodex") throw new MigrationFailure("Unsupported migration target");
	const options = args.slice(1).filter((value) => value !== "--json");
	if (options.length === 0) return { kind: "apply", dryRun: false };
	if (options.length === 1 && options[0] === "--dry-run") return { kind: "apply", dryRun: true };
	if (options.length === 2 && options[0] === "--rollback" && options[1] && isAbsolute(options[1])) {
		return { kind: "rollback", manifestPath: resolve(options[1]) };
	}
	throw new MigrationFailure("Unsupported migrate opencodex arguments");
}

export async function planOpenCodexMigration(options: PlanOpenCodexMigrationOptions): Promise<MigrationPlan> {
	const execute = options.execute ?? defaultExecutor;
	const codexHome = await canonicalDirectory(options.codexHome, "Codex home");
	const openCodexHome = await canonicalDirectory(options.openCodexHome, "OpenCodex home");
	const environments = await migrationEnvironments(codexHome, openCodexHome, options.environment);
	const inspected = await inspectInputs(
		{ codexHome, openCodexHome },
		{ execute, openCodexEnvironment: environments.openCodex },
	);
	const live = await readLiveState(execute, environments);
	assertCanonicalRouterPrestate(live);
	if (inspected.ownership.kind === "journal-v1-opencodex-2.25.0" && live.openCodex !== "running") {
		throw new MigrationFailure("OpenCodex 2.25.0 journal migration requires a proven running service");
	}
	const providerProof = await readProviderProof(execute, environments.router, inspected.providerRequirements);
	const migrationDirectory = join(inspected.codexHome, "omcs-migrations");
	const manifestPath = join(migrationDirectory, "opencodex-migration.json");
	const timestamp = Date.now();
	const backupPath = join(migrationDirectory, `config.toml.${timestamp}.bak`);
	const nativeBackupPath = join(migrationDirectory, `native-config.${timestamp}.bak`);
	const paths: MigrationManifest["paths"] = {
		codexConfig: inspected.configPath,
		catalog: inspected.catalogPath,
		openCodexHome: inspected.openCodexHome,
		backup: backupPath,
		manifest: manifestPath,
		nativeBackup: nativeBackupPath,
		owner: inspected.ownership.ownerPath,
		uninstall: inspected.ownership.uninstallPath,
		...(inspected.ownership.kind === "journal-v1-opencodex-2.25.0" ? {
			profile: inspected.ownership.profilePath,
			profileBackup: join(migrationDirectory, `profile.${timestamp}.bak`),
			journal: inspected.ownership.journalPath,
			journalBackup: join(migrationDirectory, `journal.${timestamp}.bak`),
		} : {}),
	};
	const plan = freezePlan({
		dryRun: options.dryRun,
		manifestPath,
		actions: [
			{ kind: "backup-config", path: backupPath },
			{ kind: "disable-opencodex" },
			{ kind: "enable-router" },
			{ kind: "verify-router" },
		],
		paths,
		digests: { configBefore: inspected.configDigest, catalog: inspected.catalogDigest, native: inspected.nativeDigest },
		services: {
			openCodexBefore: live.openCodex,
			routerIntegrationBefore: live.router.integration,
			routerServiceBefore: live.router.service,
		},
		providers: [...providerProof.providers],
		credentialsReady: providerProof.ready,
	});
	planCapabilities.set(plan, { publicPlan: plan, execute, environments, proofKind: inspected.ownership.kind });
	return plan;
}

function assertManifestLayout(manifestPath: string, paths: MigrationManifest["paths"]): void {
	if (manifestPath !== paths.manifest || !isAbsolute(manifestPath)) throw new MigrationFailure("Migration manifest path does not match its recorded path");
	const migrationDirectory = dirname(manifestPath);
	if (
		[manifestPath, paths.codexConfig, paths.catalog, paths.openCodexHome, paths.backup, paths.nativeBackup, paths.profile, paths.profileBackup, paths.journal, paths.journalBackup, paths.owner, paths.uninstall]
			.filter((path): path is string => Boolean(path)).some((path) => resolve(path) !== path) ||
		dirname(paths.codexConfig) !== dirname(migrationDirectory) ||
		basename(paths.codexConfig) !== "config.toml" ||
		dirname(paths.backup) !== migrationDirectory ||
		!/^config\.toml\.\d+\.bak$/.test(basename(paths.backup)) ||
		(paths.nativeBackup !== undefined && (dirname(paths.nativeBackup) !== migrationDirectory || !/^native-config\.\d+\.bak$/.test(basename(paths.nativeBackup)))) ||
		(paths.profileBackup !== undefined && (dirname(paths.profileBackup) !== migrationDirectory || !/^profile\.\d+\.bak$/.test(basename(paths.profileBackup)))) ||
		(paths.journalBackup !== undefined && (dirname(paths.journalBackup) !== migrationDirectory || !/^journal\.\d+\.bak$/.test(basename(paths.journalBackup)))) ||
		(paths.profile !== undefined && paths.profile !== join(dirname(paths.codexConfig), "opencodex.config.toml")) ||
		(paths.journal !== undefined && paths.journal !== join(dirname(paths.codexConfig), "opencodex-journal.json")) ||
		(paths.owner !== undefined && paths.owner !== join(paths.openCodexHome, ".opencodex-owner.json")) ||
		(paths.uninstall !== undefined && paths.uninstall !== join(paths.openCodexHome, ".opencodex-uninstall.json")) ||
		!isAbsolute(paths.catalog) ||
		!isAbsolute(paths.openCodexHome)
	) {
		throw new MigrationFailure("Migration manifest path layout is incompatible");
	}
}

async function ensureMigrationDirectory(path: string): Promise<void> {
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const information = await lstat(path);
		if (!information.isDirectory() || information.isSymbolicLink()) throw new MigrationFailure("Migration directory ownership is ambiguous");
	}
}

async function writeExclusiveBackup(path: string, bytes: Uint8Array): Promise<void> {
	const descriptor = await open(path, "wx", 0o600);
	try {
		await descriptor.writeFile(bytes);
		await descriptor.sync();
	} finally {
		await descriptor.close();
	}
}

async function syncParent(path: string): Promise<void> {
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function atomicReplaceIfUnchanged(
	path: string,
	bytes: Uint8Array,
	expected: FileObservation,
	hooks: {
		beforeValidation?: () => Promise<void> | void;
		afterTargetOpened?: () => Promise<void> | void;
	} = {},
): Promise<void> {
	const temporary = join(dirname(path), `.${basename(path)}.omcs-restore-${randomUUID()}`);
	let committed = false;
	try {
		const descriptor = await open(temporary, "wx", 0o600);
		try {
			await descriptor.writeFile(bytes);
			await descriptor.sync();
		} finally {
			await descriptor.close();
		}
		await hooks.beforeValidation?.();
		const current = await observeRegularFile(path, "Codex config target", MAX_CONFIG_BYTES, hooks.afterTargetOpened);
		if (!sameObservation(current, expected)) throw new MigrationFailure("Codex config target changed before final restore");
		await assertPathMatchesObservation(path, current);
		await rename(temporary, path);
		committed = true;
		await syncParent(path);
	} finally {
		if (!committed) {
			try {
				await unlink(temporary);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
}

async function restoreOptionalFileExactly(
	path: string,
	desired: Buffer | null,
	allowedCurrentDigests: ReadonlySet<string | null>,
	label: string,
	afterRemoveValidation?: (path: string) => Promise<void> | void,
): Promise<void> {
	const quarantine = join(dirname(path), `.${basename(path)}.omcs-remove-quarantine`);
	try {
		await lstat(quarantine);
		throw new MigrationFailure(`${label} has an unresolved removal quarantine at ${quarantine}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const current = await observeOptionalRegularFile(path, label, MAX_METADATA_BYTES);
	const currentDigest = current?.digest ?? null;
	if (!allowedCurrentDigests.has(currentDigest)) throw new MigrationFailure(`${label} changed outside this migration`);
	if (desired === null) {
		if (!current) return;
		await assertPathMatchesObservation(path, current, label);
		await afterRemoveValidation?.(path);
		try {
			await link(path, quarantine);
		} catch (error) {
			throw new MigrationFailure(
				`${label} could not create an atomic no-replace removal quarantine; source and destination were preserved: ${String((error as Error).message)}`,
			);
		}
		let quarantined: FileObservation;
		try {
			quarantined = await observeRegularFile(
				quarantine,
				`${label} removal quarantine`,
				MAX_METADATA_BYTES,
				undefined,
				2,
			);
		} catch (error) {
			throw new MigrationFailure(
				`${label} changed before final removal; source and linked evidence are preserved with the unresolved removal quarantine at ${quarantine}: ${String((error as Error).message)}`,
			);
		}
		if (!sameLinkedFileContent(quarantined, current)) {
			throw new MigrationFailure(
				`${label} changed before final removal; source and linked evidence are preserved in the unresolved removal quarantine at ${quarantine}`,
			);
		}
		await assertPathMatchesObservation(path, quarantined, label);
		await unlink(path);
		const uniqueQuarantine = await observeRegularFile(quarantine, `${label} removal quarantine`, MAX_METADATA_BYTES);
		if (!sameLinkedFileContent(uniqueQuarantine, current)) {
			throw new MigrationFailure(`${label} removal quarantine changed after source unlink`);
		}
		await unlink(quarantine);
		await syncParent(path);
		try {
			await lstat(path);
			throw new MigrationFailure(`${label} changed during final removal`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return;
	}
	if (current?.bytes.equals(desired)) return;
	if (current) {
		await atomicReplaceIfUnchanged(path, desired, current);
		return;
	}
	const temporary = join(dirname(path), `.${basename(path)}.omcs-restore-${randomUUID()}`);
	let installed = false;
	try {
		const descriptor = await open(temporary, "wx", 0o600);
		try {
			await descriptor.writeFile(desired);
			await descriptor.sync();
		} finally {
			await descriptor.close();
		}
		await link(temporary, path);
		installed = true;
		await unlink(temporary);
		await syncParent(path);
	} finally {
		if (!installed) await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}

async function assertDigest(path: string, expected: string, label: string, maxBytes = MAX_CONFIG_BYTES): Promise<Buffer> {
	const bytes = await safeRegularFile(path, label, maxBytes);
	if (sha256(bytes) !== expected) throw new MigrationFailure(`${label} was modified outside this migration`);
	return bytes;
}

async function assertOptionalDigest(
	path: string,
	expected: string | null,
	label: string,
	maxBytes = MAX_METADATA_BYTES,
): Promise<Buffer | null> {
	const observation = await observeOptionalRegularFile(path, label, maxBytes);
	if (expected === null) {
		if (observation) throw new MigrationFailure(`${label} appeared or changed outside this migration`);
		return null;
	}
	if (!observation || observation.digest !== expected) {
		throw new MigrationFailure(`${label} was modified outside this migration`);
	}
	return observation.bytes;
}

async function assertOptionalDigestOneOf(
	path: string,
	allowed: ReadonlySet<string | null>,
	label: string,
): Promise<Buffer | null> {
	const observation = await observeOptionalRegularFile(path, label, MAX_METADATA_BYTES);
	if (!allowed.has(observation?.digest ?? null)) throw new MigrationFailure(`${label} changed outside this migration`);
	return observation?.bytes ?? null;
}

async function acquireManifestLock(manifestPath: string): Promise<() => Promise<void>> {
	const lockPath = `${manifestPath}.lock`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(lockPath, "wx", 0o600);
			const initial = await handle.stat({ bigint: true });
			await handle.writeFile(`${process.pid}\n`, "utf8");
			await handle.sync();
			return async () => {
				try {
					const current = await lstat(lockPath, { bigint: true });
					if (current.dev === initial.dev && current.ino === initial.ino && current.isFile() && current.nlink === 1n) {
						await unlink(lockPath);
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				} finally {
					await handle.close();
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let pid: number | undefined;
			try {
				const value = (await readFile(lockPath, "utf8")).trim();
				if (/^[1-9]\d{0,9}$/.test(value)) pid = Number(value);
			} catch {
				throw new MigrationFailure("Migration lock is unreadable; concurrent ownership is unknown");
			}
			if (!pid) throw new MigrationFailure("Migration lock ownership is invalid");
			let live = true;
			try {
				process.kill(pid, 0);
			} catch (probeError) {
				live = (probeError as NodeJS.ErrnoException).code !== "ESRCH";
			}
			if (live || attempt > 0) throw new MigrationFailure("Another migration owns this manifest");
			const before = await lstat(lockPath, { bigint: true });
			const after = await lstat(lockPath, { bigint: true });
			if (
				!before.isFile() ||
				before.isSymbolicLink() ||
				before.dev !== after.dev ||
				before.ino !== after.ino ||
				!after.isFile() ||
				after.isSymbolicLink() ||
				after.nlink !== 1n
			) {
				throw new MigrationFailure("Migration lock ownership changed during recovery");
			}
			await unlink(lockPath);
		}
	}
	throw new MigrationFailure("Migration lock could not be acquired");
}

async function withManifestLock<T>(manifestPath: string, operation: () => Promise<T>, createDirectory = false): Promise<T> {
	const directory = dirname(manifestPath);
	if (createDirectory) await ensureMigrationDirectory(directory);
	const canonical = await canonicalDirectory(directory, "Migration directory");
	if (canonical !== directory) throw new MigrationFailure("Migration directory must be canonical");
	const release = await acquireManifestLock(manifestPath);
	try {
		return await operation();
	} finally {
		await release();
	}
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertRouterOwnedConfig(observation: FileObservation, nativeBytes: Buffer, routerStatus: RouterStatus): void {
	const text = observation.bytes.toString("utf8");
	if (
		routerStatus.integration !== "enabled" ||
		!hasRouterMarker(text) ||
		hasOpenCodexRouting(text) ||
		routerNeutralProjection(text) !== routerNeutralProjection(nativeBytes.toString("utf8"))
	) {
		throw new MigrationFailure("Router integration ownership could not be proven");
	}
}

export async function applyOpenCodexMigration(plan: MigrationPlan): Promise<MigrationResult> {
	const capability = planCapabilities.get(plan);
	if (!capability || capability.publicPlan !== plan) throw new MigrationFailure("An authentic migration plan with immutable authority is required");
	if (plan.dryRun) throw new MigrationFailure("A dry-run migration plan cannot be applied");
	assertManifestLayout(plan.manifestPath, plan.paths as MigrationManifest["paths"]);
	return withManifestLock(plan.manifestPath, async () => {
		try {
			await stat(plan.manifestPath);
			throw new MigrationFailure("An incomplete migration or prior manifest already exists");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const inspected = await inspectInputs(
			{ codexHome: dirname(plan.paths.codexConfig), openCodexHome: plan.paths.openCodexHome },
			{ execute: capability.execute, openCodexEnvironment: capability.environments.openCodex },
		);
		if (
			inspected.configPath !== plan.paths.codexConfig ||
			inspected.catalogPath !== plan.paths.catalog ||
			inspected.configDigest !== plan.digests.configBefore ||
			inspected.catalogDigest !== plan.digests.catalog ||
			inspected.nativeDigest !== plan.digests.native ||
			inspected.ownership.kind !== capability.proofKind ||
			!sameValues(inspected.providers, plan.providers)
		) {
			throw new MigrationFailure("Migration inputs changed after planning");
		}
		const environments = capability.environments;
		const live = await readLiveState(capability.execute, environments);
		if (
			live.openCodex !== plan.services.openCodexBefore ||
			live.router.integration !== plan.services.routerIntegrationBefore ||
			live.router.service !== plan.services.routerServiceBefore
		) {
			throw new MigrationFailure("Service state changed after migration planning");
		}
		assertCanonicalRouterPrestate(live);
		const legacy = inspected.ownership.kind === "journal-v1-opencodex-2.25.0" ? inspected.ownership : undefined;
		const manifest: MigrationManifest = {
			phase: "detected",
			paths: plan.paths as MigrationManifest["paths"],
				digests: {
				configBefore: plan.digests.configBefore,
				catalog: plan.digests.catalog,
				native: plan.digests.native,
				backup: plan.digests.configBefore,
					router: null,
					nativeBackup: inspected.nativeDigest,
					owner: inspected.ownership.ownerDigest,
					uninstall: inspected.ownership.uninstallDigest,
					...(legacy ? {
						profileBefore: legacy.profileBefore === null ? null : sha256(legacy.profileBefore),
						profileNative: legacy.profileAfterStop === null ? null : sha256(legacy.profileAfterStop),
						profileBackup: legacy.profileBefore === null ? null : sha256(legacy.profileBefore),
						journalBefore: legacy.journalDigest,
						journalNative: legacy.journalAfterStop === null ? null : sha256(legacy.journalAfterStop),
						journalBackup: legacy.journalDigest,
					} : {}),
				},
			services: plan.services as MigrationManifest["services"],
		};
		await writeMigrationManifest(plan.manifestPath, manifest);
		await writeExclusiveBackup(plan.paths.backup, inspected.config);
		await assertDigest(plan.paths.backup, manifest.digests.backup, "Migration backup");
		if (!plan.paths.nativeBackup || !manifest.digests.nativeBackup) {
			throw new MigrationFailure("Migration native backup layout is incomplete");
		}
		await writeExclusiveBackup(plan.paths.nativeBackup, inspected.nativeConfig);
		await assertDigest(plan.paths.nativeBackup, manifest.digests.nativeBackup, "Migration native backup");
		if (legacy) {
			if (!plan.paths.journalBackup || !manifest.digests.journalBackup) throw new MigrationFailure("Migration journal backup layout is incomplete");
			await writeExclusiveBackup(plan.paths.journalBackup, legacy.journal);
			await assertDigest(plan.paths.journalBackup, manifest.digests.journalBackup, "Migration journal backup", MAX_METADATA_BYTES);
			if (legacy.profileBefore !== null) {
				if (!plan.paths.profileBackup || !manifest.digests.profileBackup) throw new MigrationFailure("Migration profile backup layout is incomplete");
				await writeExclusiveBackup(plan.paths.profileBackup, legacy.profileBefore);
				await assertDigest(plan.paths.profileBackup, manifest.digests.profileBackup, "Migration profile backup", MAX_METADATA_BYTES);
			}
		}
		manifest.phase = "backed-up";
		await writeMigrationManifest(plan.manifestPath, manifest);
		const providerProof = await readProviderProof(capability.execute, environments.router, inspected.providerRequirements);
		if (!providerProof.ready) throw new MigrationFailure("Required Router providers are not configured; OpenCodex remains unchanged");

		await writeMigrationManifest(plan.manifestPath, manifest);
		await executeSafely(
			capability.execute,
			{ file: "ocx", args: ["service", "stop"], env: environments.openCodex },
			"OpenCodex service stop",
		);
		const afterStop = await observeRegularFile(plan.paths.codexConfig, "Codex config target");
		const openCodexAfterStop = await detectOpenCodexServiceState(capability.execute, environments.openCodex);
		if (
			afterStop.digest !== manifest.digests.native ||
			!afterStop.bytes.equals(inspected.nativeConfig) ||
			hasOpenCodexRouting(afterStop.bytes.toString("utf8")) ||
			openCodexAfterStop !== "stopped"
		) {
			throw new MigrationFailure("OpenCodex service stop did not restore the proven native Codex config");
		}
		if (legacy) {
			if (!plan.paths.profile || !plan.paths.journal) throw new MigrationFailure("Migration legacy evidence layout is incomplete");
			await assertOptionalDigest(plan.paths.profile, manifest.digests.profileNative ?? null, "OpenCodex profile after stop");
			await assertOptionalDigest(plan.paths.journal, manifest.digests.journalNative ?? null, "OpenCodex journal after stop");
		}
		manifest.phase = "opencodex-disabled";
		await writeMigrationManifest(plan.manifestPath, manifest);

		await writeMigrationManifest(plan.manifestPath, manifest);
		await executeSafely(
			capability.execute,
			{ file: "codex-router", args: ["enable"], env: environments.router },
			"Router enable",
		);
		const afterEnable = await observeRegularFile(plan.paths.codexConfig, "Codex config target");
		const routerAfterEnable = await readRouterStatus(capability.execute, environments.router);
		assertRouterOwnedConfig(afterEnable, afterStop.bytes, routerAfterEnable);
		manifest.digests.router = afterEnable.digest;
		manifest.phase = "router-enabled";
		await writeMigrationManifest(plan.manifestPath, manifest);
		await verifyRouterDoctor(capability.execute, environments.router);
		manifest.phase = "verified";
		await writeMigrationManifest(plan.manifestPath, manifest);
		return { phase: manifest.phase, manifestPath: plan.manifestPath };
	}, true);
}

type ConfigKind = "opencodex" | "native" | "router";

function phaseAllowsConfig(phase: MigrationPhase, kind: ConfigKind): boolean {
	if (phase === "rolled-back") return kind === "opencodex";
	if (phase === "detected") return kind === "opencodex";
	if (phase === "backed-up") return kind === "opencodex" || kind === "native";
	return true;
}

function classifyConfig(observation: FileObservation, manifest: MigrationManifest): ConfigKind | undefined {
	if (observation.digest === manifest.digests.configBefore) return "opencodex";
	if (observation.digest === manifest.digests.native) return "native";
	if (manifest.digests.router && observation.digest === manifest.digests.router) return "router";
	return undefined;
}

function parseLegacyJournalEvidence(bytes: Buffer): z.infer<typeof legacyJournalSchema> {
	try {
		const document = legacyJournalSchema.parse(JSON.parse(bytes.toString("utf8")));
		strictBase64(document.originalConfig, "OpenCodex journal original config", MAX_CONFIG_BYTES);
		if (document.originalProfile !== null) strictBase64(document.originalProfile, "OpenCodex journal original profile", MAX_METADATA_BYTES);
		return document;
	} catch (error) {
		if (error instanceof MigrationFailure) throw error;
		throw new MigrationFailure("OpenCodex journal backup is malformed or incompatible");
	}
}

function assertLegacyReinjectionOwned(
	observation: FileObservation,
	nativeBytes: Buffer,
	journal: z.infer<typeof legacyJournalSchema>,
): void {
	const content = observation.bytes.toString("utf8");
	if (
		rootTomlString(content, "openai_base_url") !== journal.injectedOpenaiBaseUrl ||
		rootTomlString(content, "model_catalog_json") !== journal.injectedCatalogPath ||
		!stripLegacyOpenCodex225(content, journal.injectedOpenaiBaseUrl).equals(nativeBytes)
	) {
		throw new MigrationFailure("OpenCodex restart ownership could not be proven");
	}
}

function assertRollbackObservation(
	observation: FileObservation,
	kind: ConfigKind,
	manifest: MigrationManifest,
	live: LiveState,
	nativeBytes: Buffer,
	legacyInjectedUrl?: string,
): void {
	if (!phaseAllowsConfig(manifest.phase, kind)) {
		throw new MigrationFailure("Codex config target is inconsistent with the durable migration phase");
	}
	const text = observation.bytes.toString("utf8");
	if (kind === "router") {
		if (
			live.router.integration !== "enabled" ||
			live.openCodex !== "stopped" ||
			!hasRouterMarker(text) ||
			hasOpenCodexRouting(text) ||
			routerNeutralProjection(text) !== routerNeutralProjection(nativeBytes.toString("utf8"))
		) {
			throw new MigrationFailure("Router rollback ownership could not be proven");
		}
		return;
	}
	if (live.router.integration !== "disabled") {
		throw new MigrationFailure("Router integration state conflicts with the observed Codex config");
	}
	if (kind === "native" && (live.openCodex !== "stopped" || hasOpenCodexRouting(text) || hasRouterMarker(text))) {
		throw new MigrationFailure("Native Codex rollback state could not be proven");
	}
	if (kind === "opencodex" && !hasOpenCodexRouting(text) && rootTomlString(text, "openai_base_url") !== legacyInjectedUrl) {
		throw new MigrationFailure("OpenCodex rollback state could not be proven");
	}
}

async function rollbackObservation(
	manifest: MigrationManifest,
	execute: MigrationCommandExecutor,
	environments: MigrationEnvironments,
	nativeBytes: Buffer,
	legacyInjectedUrl?: string,
): Promise<{ observation: FileObservation; kind: ConfigKind; live: LiveState }> {
	const observation = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
	const live = await readLiveState(execute, environments);
	let kind = classifyConfig(observation, manifest);
	if (!kind && !manifest.digests.router && live.router.integration === "enabled") {
		const text = observation.bytes.toString("utf8");
		if (
			hasRouterMarker(text) &&
			!hasOpenCodexRouting(text) &&
			live.openCodex === "stopped" &&
			routerNeutralProjection(text) === routerNeutralProjection(nativeBytes.toString("utf8"))
		) {
			kind = "router";
			if (!phaseAllowsConfig(manifest.phase, kind)) {
				throw new MigrationFailure("Codex config target is inconsistent with the durable migration phase");
			}
			manifest.digests.router = observation.digest;
			await writeMigrationManifest(manifest.paths.manifest, manifest);
		}
	}
	if (!kind) throw new MigrationFailure("Codex config target was modified outside this migration");
	assertRollbackObservation(observation, kind, manifest, live, nativeBytes, legacyInjectedUrl);
	return { observation, kind, live };
}

export async function rollbackOpenCodexMigration(
	manifestPath: string,
	options: RollbackOpenCodexMigrationOptions = {},
): Promise<MigrationResult> {
	if (!isAbsolute(manifestPath) || resolve(manifestPath) !== manifestPath) {
		throw new MigrationFailure("Migration manifest path must be absolute and canonical");
	}
	const execute = options.execute ?? defaultExecutor;
	return withManifestLock(manifestPath, async () => {
		let manifest: MigrationManifest;
		try {
			manifest = await readMigrationManifest(manifestPath);
		} catch (error) {
			throw new MigrationFailure(error instanceof Error ? error.message : "Migration manifest is invalid");
		}
		assertManifestLayout(manifestPath, manifest.paths);
		if (manifest.phase === "rolled-back") return { phase: manifest.phase, manifestPath };
		const codexHome = await canonicalDirectory(dirname(manifest.paths.codexConfig), "Codex home");
		const openCodexHome = await canonicalDirectory(manifest.paths.openCodexHome, "OpenCodex home");
		const environments = await migrationEnvironments(codexHome, openCodexHome, options.environment);
		await assertDigest(manifest.paths.catalog, manifest.digests.catalog, "OpenCodex catalog", MAX_CATALOG_BYTES);
		const hasLegacyField = Boolean(
			manifest.paths.journal || manifest.paths.journalBackup || manifest.paths.profile || manifest.paths.profileBackup
			|| manifest.digests.journalBefore || manifest.digests.journalBackup || manifest.digests.profileBefore !== undefined,
		);
		const legacy = hasLegacyField;
		if (legacy && (
			!manifest.paths.journal || !manifest.paths.journalBackup || !manifest.paths.profile || !manifest.paths.profileBackup
			|| !manifest.paths.nativeBackup || !manifest.paths.owner || !manifest.paths.uninstall
			|| !manifest.digests.journalBefore || !manifest.digests.journalBackup || manifest.digests.profileBefore === undefined
			|| manifest.digests.profileNative === undefined || manifest.digests.profileBackup === undefined
			|| manifest.digests.journalNative === undefined || !manifest.digests.nativeBackup
			|| !manifest.digests.owner || !manifest.digests.uninstall
		)) throw new MigrationFailure("Legacy migration evidence layout is incomplete");

		let legacyJournal: z.infer<typeof legacyJournalSchema> | undefined;
		let native: { digest: string; bytes: Buffer };
		if (legacy) {
			await exactOpenCodex225Version(execute, environments.openCodex);
			const metadata = await readOwnershipMetadata(openCodexHome);
			if (metadata.ownerDigest !== manifest.digests.owner || metadata.uninstallDigest !== manifest.digests.uninstall) {
				throw new MigrationFailure("OpenCodex ownership metadata changed after migration");
			}
			const journalEvidence = manifest.phase === "detected"
				? await assertDigest(manifest.paths.journal!, manifest.digests.journalBefore!, "OpenCodex journal", MAX_METADATA_BYTES)
				: await assertDigest(manifest.paths.journalBackup!, manifest.digests.journalBackup!, "Migration journal backup", MAX_METADATA_BYTES);
			legacyJournal = parseLegacyJournalEvidence(journalEvidence);
			const recordedConfigEvidence = manifest.phase === "detected"
				? await assertDigest(manifest.paths.codexConfig, manifest.digests.configBefore, "Codex config target")
				: await assertDigest(manifest.paths.backup, manifest.digests.backup, "Migration backup");
			if (legacyJournal.injectedCatalogPath !== rootTomlString(recordedConfigEvidence.toString("utf8"), "model_catalog_json")) {
				throw new MigrationFailure("OpenCodex journal backup no longer matches the recorded config");
			}
			if (manifest.phase === "detected") {
				native = { digest: manifest.digests.native, bytes: Buffer.alloc(0) };
			} else {
				const nativeBytes = await assertDigest(manifest.paths.nativeBackup!, manifest.digests.nativeBackup!, "Migration native backup");
				if (sha256(nativeBytes) !== manifest.digests.native) throw new MigrationFailure("Migration native backup does not match the recorded native config");
				native = { digest: manifest.digests.native, bytes: nativeBytes };
			}
		} else {
			const integration = await proveIntegrationOwnership(
				openCodexHome,
				manifest.paths.catalog,
				manifest.digests.catalog,
				manifest.digests.configBefore,
			);
			if (integration.digest !== manifest.digests.native) throw new MigrationFailure("OpenCodex native config proof changed after migration");
			native = integration;
		}
		if (manifest.phase === "detected") {
			const observation = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
			const live = await readLiveState(execute, environments);
			if (
				observation.digest !== manifest.digests.configBefore ||
				(!hasOpenCodexRouting(observation.bytes.toString("utf8"))
					&& rootTomlString(observation.bytes.toString("utf8"), "openai_base_url") !== legacyJournal?.injectedOpenaiBaseUrl) ||
				live.openCodex !== manifest.services.openCodexBefore ||
				live.router.integration !== manifest.services.routerIntegrationBefore ||
				live.router.service !== manifest.services.routerServiceBefore
			) {
				throw new MigrationFailure("Detected migration state no longer matches its proven pre-state");
			}
			if (legacy) {
				await assertOptionalDigest(manifest.paths.profile!, manifest.digests.profileBefore!, "OpenCodex profile");
			}
			manifest.phase = "rolled-back";
			await writeMigrationManifest(manifestPath, manifest);
			return { phase: manifest.phase, manifestPath };
		}
		const originalBytes = await assertDigest(manifest.paths.backup, manifest.digests.backup, "Migration backup");
		if (sha256(originalBytes) !== manifest.digests.configBefore) {
			throw new MigrationFailure("Migration backup does not match the recorded original config");
		}
		let current = await rollbackObservation(manifest, execute, environments, native.bytes, legacyJournal?.injectedOpenaiBaseUrl);
		if (legacy) {
			await assertOptionalDigestOneOf(
				manifest.paths.profile!,
				new Set([manifest.digests.profileBefore!, manifest.digests.profileNative!]),
				"OpenCodex profile",
			);
			await assertOptionalDigestOneOf(
				manifest.paths.journal!,
				new Set([manifest.digests.journalBefore!, manifest.digests.journalNative!]),
				"OpenCodex journal",
			);
		}

		if (current.kind === "router") {
			if (manifest.services.routerIntegrationBefore !== "disabled") {
				throw new MigrationFailure("The recorded Router integration pre-state cannot be restored safely");
			}
			await writeMigrationManifest(manifestPath, manifest);
			await executeSafely(
				execute,
				{ file: "codex-router", args: ["disable"], env: environments.router },
				"Router disable",
			);
			current = await rollbackObservation(manifest, execute, environments, native.bytes, legacyJournal?.injectedOpenaiBaseUrl);
			if (current.kind !== "native") throw new MigrationFailure("Router disable did not restore the proven native Codex config");
		}

		if (legacy && legacyJournal) {
			if (current.live.openCodex !== manifest.services.openCodexBefore) {
				if (manifest.services.openCodexBefore !== "running" || current.live.openCodex !== "stopped") {
					throw new MigrationFailure("The recorded OpenCodex service pre-state cannot be restored safely");
				}
				await writeMigrationManifest(manifestPath, manifest);
				await executeSafely(execute, { file: "ocx", args: ["service", "start"], env: environments.openCodex }, "OpenCodex service start");
				const afterStart = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
				const afterStartLive = await readLiveState(execute, environments);
				if (afterStartLive.openCodex !== "running" || afterStartLive.router.integration !== "disabled") {
					throw new MigrationFailure("OpenCodex restart did not reproduce the recorded service state");
				}
				if (afterStart.digest !== manifest.digests.configBefore) assertLegacyReinjectionOwned(afterStart, native.bytes, legacyJournal);
				current = { observation: afterStart, kind: "opencodex", live: afterStartLive };
			}
			if (current.observation.digest !== manifest.digests.configBefore) {
				assertLegacyReinjectionOwned(current.observation, native.bytes, legacyJournal);
				await atomicReplaceIfUnchanged(manifest.paths.codexConfig, originalBytes, current.observation, {
					beforeValidation: options.beforeFinalRestoreValidation,
					afterTargetOpened: options.afterRestoreTargetOpened,
				});
				await options.afterConfigRestore?.();
			}
			const profileBefore = manifest.digests.profileBefore === null
				? null
				: await assertDigest(manifest.paths.profileBackup!, manifest.digests.profileBackup!, "Migration profile backup", MAX_METADATA_BYTES);
			const journalBefore = await assertDigest(manifest.paths.journalBackup!, manifest.digests.journalBackup!, "Migration journal backup", MAX_METADATA_BYTES);
			await restoreOptionalFileExactly(
				manifest.paths.profile!,
				profileBefore,
				new Set([manifest.digests.profileBefore!, manifest.digests.profileNative!]),
				"OpenCodex profile",
				options.afterOptionalRemoveValidation,
			);
			await restoreOptionalFileExactly(
				manifest.paths.journal!,
				journalBefore,
				new Set([manifest.digests.journalBefore!, manifest.digests.journalNative!]),
				"OpenCodex journal",
				options.afterOptionalRemoveValidation,
			);
			const finalObservation = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
			const finalLive = await readLiveState(execute, environments);
			await assertOptionalDigest(manifest.paths.profile!, manifest.digests.profileBefore!, "OpenCodex profile");
			await assertOptionalDigest(manifest.paths.journal!, manifest.digests.journalBefore!, "OpenCodex journal");
			if (
				finalObservation.digest !== manifest.digests.configBefore ||
				finalLive.openCodex !== manifest.services.openCodexBefore ||
				finalLive.router.integration !== manifest.services.routerIntegrationBefore ||
				finalLive.router.service !== manifest.services.routerServiceBefore
			) throw new MigrationFailure("Rollback verification did not reproduce the recorded config, evidence, and service states");
			manifest.phase = "rolled-back";
			await writeMigrationManifest(manifestPath, manifest);
			return { phase: manifest.phase, manifestPath };
		}

		if (current.kind !== "opencodex") {
			if (current.live.openCodex !== "stopped") {
				throw new MigrationFailure("OpenCodex must remain stopped while its exact config is restored");
			}
			await atomicReplaceIfUnchanged(manifest.paths.codexConfig, originalBytes, current.observation, {
				beforeValidation: options.beforeFinalRestoreValidation,
				afterTargetOpened: options.afterRestoreTargetOpened,
			});
			await options.afterConfigRestore?.();
			const restored = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
			if (restored.digest !== manifest.digests.configBefore) throw new MigrationFailure("Exact OpenCodex config restore failed");
			current = { observation: restored, kind: "opencodex", live: current.live };
		}

		if (current.live.openCodex !== manifest.services.openCodexBefore) {
			if (manifest.services.openCodexBefore !== "running" || current.live.openCodex !== "stopped") {
				throw new MigrationFailure("The recorded OpenCodex service pre-state cannot be restored safely");
			}
			await writeMigrationManifest(manifestPath, manifest);
			await executeSafely(
				execute,
				{ file: "ocx", args: ["service", "start"], env: environments.openCodex },
				"OpenCodex service start",
			);
		}

		const finalObservation = await observeRegularFile(manifest.paths.codexConfig, "Codex config target");
		const finalLive = await readLiveState(execute, environments);
		if (
			finalObservation.digest !== manifest.digests.configBefore ||
			finalLive.openCodex !== manifest.services.openCodexBefore ||
			finalLive.router.integration !== manifest.services.routerIntegrationBefore ||
			finalLive.router.service !== manifest.services.routerServiceBefore
		) {
			throw new MigrationFailure("Rollback verification did not reproduce the recorded config and service states");
		}
		manifest.phase = "rolled-back";
		await writeMigrationManifest(manifestPath, manifest);
		return { phase: manifest.phase, manifestPath };
	});
}
