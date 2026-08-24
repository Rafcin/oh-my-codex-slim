import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export interface SafeReadOptions {
	maxBytes?: number;
	label?: string;
	afterOpen?: () => Promise<void>;
}

function missing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

function sameIdentity(left: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>, right: typeof left): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink
		&& left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Reads a uniquely linked regular file from one stable descriptor and proves the path still names it. */
export async function readBoundedRegularFile(path: string, options: SafeReadOptions = {}): Promise<Buffer | null> {
	const maximum = options.maxBytes ?? 1024 * 1024;
	const label = options.label ?? "file";
	let handle;
	let opened = false;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		opened = true;
		const before = await handle.stat();
		if (!before.isFile() || before.nlink !== 1 || before.size < 0 || before.size > maximum) {
			throw new Error(`OMCS refuses unsafe ${label}`);
		}
		await options.afterOpen?.();
		const bytes = await handle.readFile();
		if (bytes.byteLength > maximum) throw new Error(`OMCS refuses oversized ${label}`);
		const after = await handle.stat();
		if (!sameIdentity(before, after)) throw new Error(`OMCS ${label} changed while reading`);
		const named = await lstat(path);
		if (named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino || named.nlink !== 1) {
			throw new Error(`OMCS ${label} path identity changed while reading`);
		}
		return bytes;
	} catch (error) {
		if (!opened && missing(error)) return null;
		if (opened && missing(error)) throw new Error(`OMCS ${label} path identity changed while reading`);
		throw error;
	} finally {
		await handle?.close();
	}
}
