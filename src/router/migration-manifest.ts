import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

export const MIGRATION_PHASES = [
	"detected",
	"backed-up",
	"opencodex-disabled",
	"router-enabled",
	"verified",
	"rolled-back",
] as const;

export type MigrationPhase = (typeof MIGRATION_PHASES)[number];
export type OpenCodexServiceState = "running" | "stopped";
export type RouterIntegrationState = "enabled" | "disabled";
export type RouterServiceState = "running" | "stopped";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const absolutePathSchema = z.string().min(1).refine((value) => value.startsWith("/"), {
	message: "Migration paths must be absolute",
});

export const migrationManifestSchema = z
	.object({
		phase: z.enum(MIGRATION_PHASES),
		paths: z
			.object({
				codexConfig: absolutePathSchema,
				catalog: absolutePathSchema,
				openCodexHome: absolutePathSchema,
				backup: absolutePathSchema,
				manifest: absolutePathSchema,
				nativeBackup: absolutePathSchema.optional(),
				profile: absolutePathSchema.optional(),
				profileBackup: absolutePathSchema.optional(),
				journal: absolutePathSchema.optional(),
				journalBackup: absolutePathSchema.optional(),
				owner: absolutePathSchema.optional(),
				uninstall: absolutePathSchema.optional(),
			})
			.strict(),
		digests: z
			.object({
				configBefore: digestSchema,
				catalog: digestSchema,
				native: digestSchema,
				backup: digestSchema,
				router: digestSchema.nullable(),
				nativeBackup: digestSchema.optional(),
				profileBefore: digestSchema.nullable().optional(),
				profileNative: digestSchema.nullable().optional(),
				profileBackup: digestSchema.nullable().optional(),
				journalBefore: digestSchema.optional(),
				journalNative: digestSchema.nullable().optional(),
				journalBackup: digestSchema.optional(),
				owner: digestSchema.optional(),
				uninstall: digestSchema.optional(),
			})
			.strict(),
		services: z
			.object({
				openCodexBefore: z.enum(["running", "stopped"]),
				routerIntegrationBefore: z.enum(["enabled", "disabled"]),
				routerServiceBefore: z.enum(["running", "stopped"]),
			})
			.strict(),
	})
	.strict();

export type MigrationManifest = z.infer<typeof migrationManifestSchema>;

export interface ReadMigrationManifestOptions {
	afterOpen?: () => Promise<void> | void;
}

export interface WriteMigrationManifestOptions {
	beforeCommit?: () => Promise<void> | void;
}

const MAX_MANIFEST_BYTES = 64 * 1024;

async function syncDirectory(path: string): Promise<void> {
	let directory;
	try {
		directory = await open(path, "r");
		await directory.sync();
	} finally {
		await directory?.close();
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readManifestBytes(
	manifestPath: string,
	options: ReadMigrationManifestOptions = {},
): Promise<Buffer | null> {
	const noFollow = (constants as unknown as Record<string, number>).O_NOFOLLOW ?? 0;
	let descriptor;
	try {
		descriptor = await open(manifestPath, constants.O_RDONLY | noFollow);
	} catch (error) {
		if (isMissing(error)) return null;
		throw new Error("Migration manifest is not a safe regular file");
	}
	try {
		await options.afterOpen?.();
		const before = await descriptor.stat({ bigint: true });
		if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_MANIFEST_BYTES)) {
			throw new Error("Migration manifest is not a safe regular file");
		}
		const buffer = Buffer.alloc(Math.min(MAX_MANIFEST_BYTES + 1, Number(before.size) + 1));
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await descriptor.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		const after = await descriptor.stat({ bigint: true });
		let pathState;
		try {
			pathState = await lstat(manifestPath, { bigint: true });
		} catch {
			throw new Error("Migration manifest changed while it was being read");
		}
		const identityMatches =
			before.dev === after.dev &&
			before.ino === after.ino &&
			before.mode === after.mode &&
			before.nlink === after.nlink &&
			before.size === after.size &&
			before.mtimeNs === after.mtimeNs &&
			before.ctimeNs === after.ctimeNs &&
			pathState.dev === after.dev &&
			pathState.ino === after.ino &&
			pathState.mode === after.mode &&
			pathState.nlink === after.nlink &&
			pathState.size === after.size &&
			pathState.mtimeNs === after.mtimeNs &&
			pathState.ctimeNs === after.ctimeNs;
		if (
			!after.isFile() ||
			after.nlink !== 1n ||
			after.size > BigInt(MAX_MANIFEST_BYTES) ||
			offset !== Number(after.size) ||
			pathState.isSymbolicLink() ||
			!pathState.isFile() ||
			!identityMatches
		) {
			throw new Error("Migration manifest changed while it was being read");
		}
		return buffer.subarray(0, offset);
	} finally {
		await descriptor.close();
	}
}

function parseManifestBytes(bytes: Buffer, manifestPath: string): MigrationManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("Migration manifest is unreadable or malformed");
	}
	const validated = migrationManifestSchema.safeParse(parsed);
	if (!validated.success || validated.data.paths.manifest !== manifestPath) {
		throw new Error("Migration manifest has an incompatible or mismatched shape");
	}
	return validated.data;
}

async function restoreQuarantined(manifestPath: string, quarantinePath: string): Promise<void> {
	await link(quarantinePath, manifestPath);
	await unlink(quarantinePath);
	await syncDirectory(dirname(manifestPath));
}

export async function writeMigrationManifest(
	manifestPath: string,
	manifest: MigrationManifest,
	options: WriteMigrationManifestOptions = {},
): Promise<void> {
	const validated = migrationManifestSchema.parse(manifest);
	const expected = await readManifestBytes(manifestPath);
	if (expected) parseManifestBytes(expected, manifestPath);
	let temporaryPath: string | undefined = join(dirname(manifestPath), `.${basename(manifestPath)}.omcs-${randomUUID()}.tmp`);
	const descriptor = await open(temporaryPath, "wx", 0o600);
	try {
		await descriptor.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
		await descriptor.sync();
	} finally {
		await descriptor.close();
	}
	let quarantinePath: string | undefined;
	try {
		await options.beforeCommit?.();
		if (expected) {
			const current = await readManifestBytes(manifestPath);
			if (!current?.equals(expected)) {
				throw new Error("Migration manifest ownership changed before commit");
			}
			quarantinePath = join(dirname(manifestPath), `.${basename(manifestPath)}.omcs-${randomUUID()}.quarantine`);
			await rename(manifestPath, quarantinePath);
			await syncDirectory(dirname(manifestPath));
			const moved = await readManifestBytes(quarantinePath);
			if (!moved?.equals(expected)) {
				try {
					await restoreQuarantined(manifestPath, quarantinePath);
					quarantinePath = undefined;
				} catch (rollbackError) {
					throw new AggregateError(
						[new Error("Migration manifest ownership changed before commit"), rollbackError],
						"Migration manifest quarantine reconciliation failed",
					);
				}
				throw new Error("Migration manifest ownership changed before commit");
			}
		} else if (await readManifestBytes(manifestPath)) {
			throw new Error("Migration manifest appeared before commit");
		}
		await link(temporaryPath, manifestPath);
		await unlink(temporaryPath);
		temporaryPath = undefined;
		await syncDirectory(dirname(manifestPath));
		if (quarantinePath) {
			await unlink(quarantinePath);
			quarantinePath = undefined;
			await syncDirectory(dirname(manifestPath));
		}
	} catch (error) {
		if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
		if (quarantinePath) {
			try {
				await restoreQuarantined(manifestPath, quarantinePath);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], "Migration manifest replacement and rollback failed");
			}
		}
		throw error;
	}
}

export async function readMigrationManifest(
	manifestPath: string,
	options: ReadMigrationManifestOptions = {},
): Promise<MigrationManifest> {
	const bytes = await readManifestBytes(manifestPath, options);
	if (!bytes) throw new Error("Migration manifest is not a safe regular file");
	return parseManifestBytes(bytes, manifestPath);
}
