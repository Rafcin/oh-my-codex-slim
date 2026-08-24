import { fileURLToPath } from "node:url";

/** Package root for both src/cli and dist/cli execution layouts. */
export function omcsPackageRoot(): string {
	return fileURLToPath(new URL("../../", import.meta.url));
}
