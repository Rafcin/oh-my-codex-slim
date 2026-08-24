export type NativeArchiveEntryType = "file" | "directory";

function policyError(code: string, detail: string): Error {
  return new Error(`[native-assets] ${code}: ${detail}`);
}

/** Normalizes archive entry names and rejects paths that could escape extraction roots. */
export function normalizeNativeArchivePath(path: string, type: NativeArchiveEntryType): string {
  if (typeof path !== "string" || path.length === 0) throw policyError("archive_path_invalid", "path is empty");
  if (/[\u0000-\u001f\u007f\u0080-\u009f\\\\]/.test(path)) throw policyError("archive_path_invalid", path);
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) throw policyError("archive_path_absolute", path);

  const hasTrailingSlash = path.endsWith("/");
  if (type === "file" && hasTrailingSlash) throw policyError("archive_path_type_mismatch", path);
  const body = hasTrailingSlash ? path.slice(0, -1) : path;
  if (!body || body.endsWith("/") || body.includes("//")) throw policyError("archive_path_invalid", path);
  const segments = body.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) throw policyError("archive_path_traversal", path);
  return body;
}

/** Rejects duplicate or file/directory-collision archive members before extraction. */
export function assertSafeNativeArchiveEntries(entries: Iterable<{ path: string; type: NativeArchiveEntryType }>): void {
  const paths = new Map<string, NativeArchiveEntryType>();
  for (const entry of entries) {
    const normalized = normalizeNativeArchivePath(entry.path, entry.type);
    if (paths.has(normalized)) throw policyError("archive_path_duplicate", normalized);
    for (const [existingPath, existingType] of paths) {
      if ((existingType === "file" && normalized.startsWith(`${existingPath}/`))
        || (entry.type === "file" && existingPath.startsWith(`${normalized}/`))) {
        throw policyError("archive_path_prefix_collision", normalized);
      }
    }
    paths.set(normalized, entry.type);
  }
}
