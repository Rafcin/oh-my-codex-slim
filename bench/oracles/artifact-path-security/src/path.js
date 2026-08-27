import { isAbsolute, relative, resolve, sep } from "node:path";

export function resolveArtifactPath(root, input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0") || input.includes("\\") || isAbsolute(input)) {
    throw new Error("invalid artifact path");
  }
  const canonicalRoot = resolve(root);
  const candidate = resolve(canonicalRoot, input);
  const fromRoot = relative(canonicalRoot, candidate);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("outside artifact root");
  }
  return candidate;
}
