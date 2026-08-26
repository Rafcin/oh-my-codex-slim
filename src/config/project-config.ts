import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { type OmcsConfig, parseOmcsConfig } from "./omcs-config.js";
import { readBoundedRegularFile } from "./safe-reader.js";

export interface WriteOmcsConfigOptions {
	path: string;
	config: OmcsConfig;
	update: boolean;
	dryRun: boolean;
}

export interface WriteOmcsConfigReport {
	action: "create" | "unchanged" | "update" | "would-create" | "would-update";
	path: string;
	bytes: number;
}

interface WriteHooks {
	afterCommit?: () => Promise<void>;
}

let testHooks: WriteHooks | undefined;

/** Test-only fault injection for proving post-rename rollback. */
export function __setWriteOmcsConfigHooksForTest(hooks?: WriteHooks): void {
	testHooks = hooks;
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

function refuses(message: string): Error {
	return new Error(`OMCS refuses unsafe configuration write: ${message}`);
}

/** Renders the stable public version-one configuration schema without hidden metadata. */
export function renderOmcsConfig(config: OmcsConfig): Buffer {
	const bytes = Buffer.from(`${JSON.stringify(config, null, "\t")}\n`, "utf8");
	parseOmcsConfig(bytes, "written");
	return bytes;
}

async function ensureSafeParent(path: string, create: boolean): Promise<string> {
	const parent = dirname(path);
	const root = parse(parent).root;
	const components = relative(root, parent).split(sep).filter(Boolean);
	let current = root;
	for (const component of components) {
		current = resolve(current, component);
		try {
			const state = await lstat(current);
			// macOS exposes its system temporary directory through /var -> /private/var.
			// It is a root-level platform alias, not a caller-controlled parent.
			if (state.isSymbolicLink() && (current === "/var" || current === "/tmp")) continue;
			if (state.isSymbolicLink()) throw refuses(`symlinked ancestor: ${current}`);
			if (!state.isDirectory()) throw refuses(`non-directory ancestor: ${current}`);
		} catch (error) {
			if (!isMissing(error)) throw error;
			if (!create) continue;
			await mkdir(current, { mode: 0o755 });
			const state = await lstat(current);
			if (state.isSymbolicLink() || !state.isDirectory()) throw refuses(`unsafe created ancestor: ${current}`);
		}
	}
	return parent;
}

async function writeStage(directory: string, bytes: Buffer): Promise<string> {
	const stage = resolve(directory, `.omcs-config-${process.pid}-${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
		await handle.writeFile(bytes);
		await handle.sync();
		return stage;
	} catch (error) {
		await unlink(stage).catch(() => undefined);
		throw error;
	} finally {
		await handle?.close();
	}
}

async function syncDirectory(directory: string): Promise<void> {
	const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function readExisting(path: string): Promise<Buffer | null> {
	try {
		const state = await lstat(path);
		if (state.isSymbolicLink() || !state.isFile() || state.nlink !== 1) throw refuses(`unsafe existing file: ${path}`);
		const bytes = await readBoundedRegularFile(path, { label: "configuration" });
		return bytes;
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

/**
 * Creates a new config or explicitly replaces a parseable prior OMCS config.
 * The writer never claims files via a project manifest: a different existing
 * file is user-owned until the caller deliberately supplies --update.
 */
export async function writeOmcsConfig(options: WriteOmcsConfigOptions): Promise<WriteOmcsConfigReport> {
	const path = resolve(options.path);
	const bytes = renderOmcsConfig(options.config);
	const directory = await ensureSafeParent(path, !options.dryRun);
	const existing = await readExisting(path);

	if (existing && existing.equals(bytes)) {
		return { action: "unchanged", path, bytes: bytes.byteLength };
	}
	if (existing && !options.update) {
		throw new Error("OMCS refuses to replace an existing user-owned configuration without --update");
	}
	if (existing && options.update) parseOmcsConfig(existing, "existing");

	const action = existing ? "update" : "create";
	if (options.dryRun) return { action: `would-${action}` as "would-create" | "would-update", path, bytes: bytes.byteLength };

	let stage: string | undefined;
	let committed = false;
	try {
		stage = await writeStage(directory, bytes);
		await rename(stage, path);
		stage = undefined;
		committed = true;
		await testHooks?.afterCommit?.();
		await syncDirectory(directory);
		return { action, path, bytes: bytes.byteLength };
	} catch (error) {
		if (committed) {
			try {
				if (existing) {
					const restore = await writeStage(directory, existing);
					await rename(restore, path);
				} else {
					await unlink(path);
				}
				await syncDirectory(directory);
			} catch (restoreError) {
				throw new Error("OMCS configuration commit failed and exact rollback could not be completed", { cause: restoreError });
			}
		}
		throw error;
	} finally {
		if (stage) await unlink(stage).catch(() => undefined);
	}
}
