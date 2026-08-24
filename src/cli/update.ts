import { setup, type SetupOptions, type SetupReport } from "./setup.js";

/** Explicit-only update: reconcile the current package through setup ownership. */
export async function update(options: SetupOptions = {}): Promise<SetupReport> {
	return setup(options);
}
