export const MANAGED_CONFIG_START = "# omcs:begin";
export const MANAGED_CONFIG_END = "# omcs:end";
export const OMCS_LIFECYCLE_MARKER = "# OMCS lifecycle marker; Codex CLI owns marketplace registration.";

function managedBlock(): RegExp {
	return new RegExp(
		`(?:^|\\n)${MANAGED_CONFIG_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?${MANAGED_CONFIG_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\n|$)`,
		"g",
	);
}

export function hasManagedConfigBlock(config: string): boolean {
	return managedBlock().test(config);
}

/** Preserve user configuration while replacing the single OMCS-owned block. */
export function mergeConfig(existing: string, managed: string): string {
	const userConfig = existing.replace(managedBlock(), "").replace(/\n+$/, "");
  const body = managed.trim();
  return [userConfig, MANAGED_CONFIG_START, body, MANAGED_CONFIG_END]
    .filter((line, index) => line.length > 0 || index > 0)
    .join("\n")
    .concat("\n");
}

/** Remove only the uniquely delimited OMCS block and preserve all other bytes. */
export function removeManagedConfigBlock(config: string): string {
	return config.replace(managedBlock(), "").replace(/^\n/, "");
}

export function extractManagedConfigBlock(config: string): string | null {
	const match = managedBlock().exec(config);
	return match ? match[0].replace(/^\n/, "") : null;
}
