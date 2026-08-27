import { resolve } from "node:path";

export function resolveArtifactPath(root, input) {
  const candidate = resolve(root, input);
  if (!candidate.startsWith(resolve(root))) throw new Error("outside artifact root");
  return candidate;
}
