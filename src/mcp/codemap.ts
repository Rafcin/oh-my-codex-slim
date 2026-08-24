import { lstat, open, opendir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import {
	canonicalProjectRoot,
	captureProjectPath,
	errorResult,
	revalidateProjectPath,
	SafePathError,
	type ToolResult,
} from "./ast.js";

const EXCLUDED_DIRECTORIES = new Set([
	".git",
	".omcs",
	"node_modules",
	"dist",
	"coverage",
]);
const CODE_EXTENSIONS = new Set([
	".c",
	".cc",
	".cpp",
	".cs",
	".go",
	".h",
	".hpp",
	".java",
	".js",
	".jsx",
	".kt",
	".m",
	".mm",
	".php",
	".py",
	".rb",
	".rs",
	".scala",
	".swift",
	".ts",
	".tsx",
	".vue",
]);
export const MAX_CODEMAP_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_CODEMAP_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_CODEMAP_DEPTH = 64;
export const MAX_CODEMAP_ENTRIES = 50_000;
export const MAX_CODEMAP_ENTRIES_PER_DIRECTORY = 10_000;

export interface CodeMapInput {
	root: string;
	path?: string;
	maxFiles?: number;
}

export interface CodeMapFile {
	path: string;
	bytes: number;
	lines: number;
}

export interface CodeMapTraversalLimits {
	maxEntries?: number;
	maxEntriesPerDirectory?: number;
}

function boundedEntryLimit(
	requested: number | undefined,
	fallback: number,
	maximum: number,
): number {
	if (requested === undefined || !Number.isSafeInteger(requested)) return fallback;
	return Math.max(1, Math.min(requested, maximum));
}

export async function buildCodeMap(
	input: CodeMapInput,
	limits: CodeMapTraversalLimits = {},
): Promise<ToolResult<{ files: CodeMapFile[]; truncated: boolean }>> {
	try {
		const root = await canonicalProjectRoot(input.root);
		const startSnapshot = await captureProjectPath(root, input.path ?? ".");
		const start = startSnapshot.target;
		const requestedSegments = relative(root, start).split(sep).filter(Boolean);
		if (
			requestedSegments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))
		) {
			return { ok: true, data: { files: [], truncated: false } };
		}
		const maximum = Math.max(1, Math.min(input.maxFiles ?? 2_000, 10_000));
		const files: CodeMapFile[] = [];
		let truncated = false;
		let totalBytes = 0;
		let visitedEntries = 0;
		const maximumEntries = boundedEntryLimit(
			limits.maxEntries,
			MAX_CODEMAP_ENTRIES,
			MAX_CODEMAP_ENTRIES,
		);
		const maximumEntriesPerDirectory = Math.min(
			maximumEntries,
			boundedEntryLimit(
				limits.maxEntriesPerDirectory,
				MAX_CODEMAP_ENTRIES_PER_DIRECTORY,
				MAX_CODEMAP_ENTRIES_PER_DIRECTORY,
			),
		);

		async function visit(path: string, depth = 0): Promise<void> {
			if (depth > MAX_CODEMAP_DEPTH)
				throw new SafePathError(
					"resource-limit",
					"Codemap traversal exceeds the depth limit",
				);
			if (files.length >= maximum) {
				truncated = true;
				return;
			}
			const entry = await lstat(path);
			if (entry.isSymbolicLink()) return;
			if (entry.isFile()) {
				if (entry.nlink !== 1)
					throw new SafePathError(
						"ownership-conflict",
						"Hard-linked source files are not safe inspection targets",
					);
				if (!CODE_EXTENSIONS.has(extname(path).toLowerCase())) return;
				const handle = await open(path, "r");
				let bytes: Buffer;
				try {
					const opened = await handle.stat();
					if (
						!opened.isFile() ||
						opened.nlink !== 1 ||
						opened.dev !== entry.dev ||
						opened.ino !== entry.ino
					) {
						throw new SafePathError(
							"ownership-conflict",
							"Source file identity changed during codemap inspection",
						);
					}
					if (opened.size > MAX_CODEMAP_FILE_BYTES)
						throw new SafePathError(
							"resource-limit",
							"Codemap file exceeds the per-file byte limit",
						);
					if (totalBytes + Number(opened.size) > MAX_CODEMAP_TOTAL_BYTES)
						throw new SafePathError(
							"resource-limit",
							"Codemap exceeds the aggregate byte limit",
						);
					bytes = Buffer.alloc(Number(opened.size));
					let offset = 0;
					while (offset < bytes.length) {
						const result = await handle.read(
							bytes,
							offset,
							bytes.length - offset,
							offset,
						);
						if (result.bytesRead === 0) break;
						offset += result.bytesRead;
					}
					const recheckedFile = await handle.stat();
					if (
						offset !== bytes.length ||
						recheckedFile.size !== opened.size ||
						recheckedFile.dev !== opened.dev ||
						recheckedFile.ino !== opened.ino
					) {
						throw new SafePathError(
							"ownership-conflict",
							"Source file changed during codemap inspection",
						);
					}
					totalBytes += bytes.byteLength;
				} finally {
					await handle.close();
				}
				files.push({
					path: relative(root, path).split(sep).join("/"),
					bytes: bytes.byteLength,
					lines:
						bytes.byteLength === 0
							? 0
							: bytes.toString("utf8").split("\n").length,
				});
				return;
			}
			if (!entry.isDirectory()) return;
			const children = [];
			const directory = await opendir(path);
			try {
				while (true) {
					const child = await directory.read();
					if (child === null) break;
					visitedEntries += 1;
					if (
						visitedEntries > maximumEntries ||
						children.length >= maximumEntriesPerDirectory
					) {
						throw new SafePathError(
							"resource-limit",
							"Codemap traversal exceeds the directory entry limit",
						);
					}
					children.push(child);
				}
			} finally {
				await directory.close();
			}
			const rechecked = await lstat(path);
			if (
				!rechecked.isDirectory() ||
				rechecked.isSymbolicLink() ||
				rechecked.dev !== entry.dev ||
				rechecked.ino !== entry.ino
			) {
				throw new SafePathError(
					"ownership-conflict",
					"Source directory identity changed during codemap inspection",
				);
			}
			for (const child of children.sort((left, right) =>
				left.name.localeCompare(right.name),
			)) {
				if (child.isDirectory() && EXCLUDED_DIRECTORIES.has(child.name))
					continue;
				if (child.isSymbolicLink()) continue;
				await visit(join(path, child.name), depth + 1);
				if (truncated) return;
			}
		}

		await revalidateProjectPath(startSnapshot);
		await visit(start);
		await revalidateProjectPath(startSnapshot);
		files.sort((left, right) => left.path.localeCompare(right.path));
		return { ok: true, data: { files, truncated } };
	} catch (error) {
		return errorResult(error, "codemap-failed");
	}
}
