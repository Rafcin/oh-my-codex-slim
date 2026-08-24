export interface PacketInput {
	objective: string;
	ownership: readonly string[];
	context: readonly string[];
	constraints: readonly string[];
	evidenceRequired: readonly string[];
}

function requiredText(label: string, value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`Delegation packet ${label} must not be empty`);
	return normalized;
}

function requiredItems(label: string, values: readonly string[]): string[] {
	if (values.length === 0) throw new Error(`Delegation packet ${label} must not be empty`);
	return values.map((value) => requiredText(label, value));
}

function section(title: string, values: readonly string[]): string[] {
	return [`## ${title}`, ...values.map((value) => `- ${value}`)];
}

export function buildDelegationPacket(input: PacketInput): string {
	const objective = requiredText("objective", input.objective);
	const ownership = requiredItems("ownership", input.ownership);
	const context = requiredItems("context", input.context);
	const constraints = requiredItems("constraints", input.constraints);
	const evidenceRequired = requiredItems("evidence required", input.evidenceRequired);
	return [
		"## Objective",
		objective,
		"",
		...section("Ownership", ownership),
		"",
		...section("Context", context),
		"",
		...section("Constraints", constraints),
		"",
		...section("Evidence Required", evidenceRequired),
	].join("\n");
}
