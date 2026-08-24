import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_CATALOG } from "../agents/catalog.js";
import { agentRelativePath, renderAgentToml } from "../agents/install.js";
import { canonicalizeCodexHome, resolveCodexHome } from "../config/codex-home.js";
import { extractManagedConfigBlock, hasManagedConfigBlock, removeManagedConfigBlock } from "../config/generator.js";
import { managedFilesManifestPath, readManagedFilesManifest } from "../config/managed-files.js";
import { readBoundedRegularFile } from "../config/safe-reader.js";

export interface UninstallOptions { codexHome?: string; dryRun?: boolean; now?: () => Date }
export interface UninstallReport { changed: string[]; unchanged: string[]; conflicts: string[]; backups: string[] }
export interface UninstallDependencies {
	beforeMutation?: (relativePath: string) => Promise<void>;
	afterValidation?: (relativePath: string) => Promise<void>;
	beforeRollbackMutation?: (relativePath: string) => Promise<void>;
}

interface Snapshot { relativePath: string; path: string; bytes: Buffer }

function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function readUniqueRegular(path: string): Promise<Buffer | null> {
	return readBoundedRegularFile(path, { label: "lifecycle file" });
}

async function createNoClobber(path: string, bytes: Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomUUID()}.omcs.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await link(temporary, path);
		await rm(temporary);
		const directory = await open(dirname(path), "r");
		try { await directory.sync(); } finally { await directory.close(); }
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(temporary, { force: true });
		throw error;
	}
}

async function syncDirectory(path: string): Promise<void> {
	const directory = await open(path, "r");
	try { await directory.sync(); } finally { await directory.close(); }
}

async function assertUnchanged(snapshot: Snapshot): Promise<void> {
	const current = await readUniqueRegular(snapshot.path);
	if (!current?.equals(snapshot.bytes)) throw new Error(`OMCS target changed during uninstall: ${snapshot.relativePath}`);
}

interface Quarantine { snapshot: Snapshot; path: string }

async function restoreQuarantine(quarantine: Quarantine): Promise<void> {
	const current = await readUniqueRegular(quarantine.snapshot.path);
	if (current) throw new Error(`OMCS refuses to overwrite a concurrent lifecycle replacement: ${quarantine.snapshot.relativePath}`);
	await link(quarantine.path, quarantine.snapshot.path);
	await rm(quarantine.path);
	await syncDirectory(dirname(quarantine.snapshot.path));
}

async function quarantineSnapshot(snapshot: Snapshot, dependencies: UninstallDependencies): Promise<Quarantine> {
	await dependencies.beforeMutation?.(snapshot.relativePath);
	await assertUnchanged(snapshot);
	await dependencies.afterValidation?.(snapshot.relativePath);
	const quarantine: Quarantine = { snapshot, path: join(dirname(snapshot.path), `.${randomUUID()}.omcs-uninstall`) };
	await rename(snapshot.path, quarantine.path);
	await syncDirectory(dirname(snapshot.path));
	const moved = await readUniqueRegular(quarantine.path);
	if (!moved?.equals(snapshot.bytes)) {
		try { await restoreQuarantine(quarantine); } catch (rollbackError) {
			throw new AggregateError([new Error(`OMCS target changed during uninstall: ${snapshot.relativePath}`), rollbackError], "OMCS quarantine reconciliation failed");
		}
		throw new Error(`OMCS target changed during uninstall: ${snapshot.relativePath}`);
	}
	return quarantine;
}

async function quarantineRollbackSnapshot(snapshot: Snapshot, dependencies: UninstallDependencies): Promise<Quarantine> {
	await assertUnchanged(snapshot);
	await dependencies.beforeRollbackMutation?.(snapshot.relativePath);
	const quarantine: Quarantine = { snapshot, path: join(dirname(snapshot.path), `.${randomUUID()}.omcs-rollback`) };
	await rename(snapshot.path, quarantine.path);
	await syncDirectory(dirname(snapshot.path));
	const moved = await readUniqueRegular(quarantine.path);
	if (!moved?.equals(snapshot.bytes)) {
		try { await restoreQuarantine(quarantine); } catch (rollbackError) {
			throw new AggregateError([new Error(`OMCS rollback target changed: ${snapshot.relativePath}`), rollbackError], "OMCS rollback quarantine reconciliation failed");
		}
		throw new Error(`OMCS rollback target changed: ${snapshot.relativePath}`);
	}
	return quarantine;
}

export async function uninstall(options: UninstallOptions = {}, dependencies: UninstallDependencies = {}): Promise<UninstallReport> {
	const codexHome = await canonicalizeCodexHome(resolveCodexHome({ codexHome: options.codexHome }));
	const expectedPaths = ["config.toml", ...AGENT_CATALOG.map(agentRelativePath).sort()];
	const manifest = await readManagedFilesManifest(codexHome);
	const records = new Map(manifest.files.map((record) => [record.path, record]));
	const conflicts: string[] = [];
	const snapshots: Snapshot[] = [];
	for (const relativePath of expectedPaths) {
		const path = join(codexHome, relativePath);
		try {
			const bytes = await readUniqueRegular(path);
			const record = records.get(relativePath);
			if (!bytes) {
				if (record) conflicts.push(relativePath);
				continue;
			}
			const legacyMatches = relativePath === "config.toml"
				? hasManagedConfigBlock(bytes.toString("utf8"))
				: bytes.toString("utf8") === renderAgentToml(AGENT_CATALOG.find((agent) => agentRelativePath(agent) === relativePath)!);
			const digestMatches = record ? digest(bytes) === record.sha256 : false;
			const currentBlock = relativePath === "config.toml" ? extractManagedConfigBlock(bytes.toString("utf8")) : null;
			const blockOwnedConfig = relativePath === "config.toml" && currentBlock !== null && (record
				? record.ownedBlockSha256 !== undefined && digest(Buffer.from(currentBlock)) === record.ownedBlockSha256
				: legacyMatches);
			if (record ? !digestMatches && !blockOwnedConfig : manifest.files.length > 0 || !legacyMatches) conflicts.push(relativePath);
			else snapshots.push({ relativePath, path, bytes });
		} catch { conflicts.push(relativePath); }
	}
	for (const record of manifest.files) if (!expectedPaths.includes(record.path)) conflicts.push(record.path);
	if (conflicts.length > 0) return { changed: [], unchanged: [], conflicts: [...new Set(conflicts)].sort(), backups: [] };

	const config = snapshots.find((snapshot) => snapshot.relativePath === "config.toml");
	if (!config) return { changed: [], unchanged: [], conflicts: ["config.toml"], backups: [] };
	const desiredConfig = Buffer.from(removeManagedConfigBlock(config.bytes.toString("utf8")));
	const changed = snapshots.map((snapshot) => snapshot.relativePath);
	const stamp = (options.now ?? (() => new Date()))().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	const backupRelative = `config.toml.bak-${stamp}`;
	const backupPath = join(codexHome, backupRelative);
	if (await readUniqueRegular(backupPath)) return { changed: [], unchanged: [], conflicts: [backupRelative], backups: [] };
	if (options.dryRun) return { changed, unchanged: [], conflicts: [], backups: [backupRelative] };

	const manifestPath = managedFilesManifestPath(codexHome);
	const manifestBefore = await readUniqueRegular(manifestPath);
	const quarantines: Quarantine[] = [];
	try {
		await createNoClobber(backupPath, config.bytes);
		await dependencies.afterValidation?.(backupRelative);
		if (!(await readUniqueRegular(backupPath))?.equals(config.bytes)) throw new Error(`OMCS backup changed during uninstall: ${backupRelative}`);
		quarantines.push(await quarantineSnapshot(config, dependencies));
		await createNoClobber(config.path, desiredConfig);
		for (const snapshot of snapshots.filter((candidate) => candidate.relativePath !== "config.toml")) {
			quarantines.push(await quarantineSnapshot(snapshot, dependencies));
		}
		if (manifestBefore) {
			quarantines.push(await quarantineSnapshot({
				relativePath: "oh-my-codex-slim/managed-files.json", path: manifestPath, bytes: manifestBefore,
			}, dependencies));
		}
		for (const quarantine of quarantines) await rm(quarantine.path);
		for (const directory of new Set(quarantines.map((entry) => dirname(entry.path)))) await syncDirectory(directory);
		return { changed, unchanged: [], conflicts: [], backups: [backupRelative] };
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		for (const quarantine of [...quarantines].reverse()) {
			try {
				let mutation: Quarantine | undefined;
				if (quarantine.snapshot.relativePath === "config.toml") {
					mutation = await quarantineRollbackSnapshot({
						relativePath: "config.toml", path: quarantine.snapshot.path, bytes: desiredConfig,
					}, dependencies);
				}
				await restoreQuarantine(quarantine);
				if (mutation) {
					await rm(mutation.path);
					await syncDirectory(dirname(mutation.path));
				}
			} catch (rollbackError) { rollbackErrors.push(rollbackError); }
		}
		try {
			const backup = await readUniqueRegular(backupPath);
			if (backup?.equals(config.bytes)) {
				const mutation = await quarantineRollbackSnapshot({ relativePath: backupRelative, path: backupPath, bytes: config.bytes }, dependencies);
				await rm(mutation.path);
				await syncDirectory(dirname(mutation.path));
			}
			else if (backup) rollbackErrors.push(new Error("OMCS refuses to remove a concurrent backup replacement"));
		} catch (rollbackError) { rollbackErrors.push(rollbackError); }
		if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "OMCS uninstall and rollback failed");
		throw error;
	}
}
