export interface PacketInput {
	objective: string;
	ownership: readonly string[];
	interfaces: readonly string[];
	context: readonly string[];
	constraints: readonly string[];
	verification: readonly string[];
	returnContract: readonly string[];
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

function exactOwnershipPaths(values: readonly string[]): string[] {
	const ownership = requiredItems("ownership", values);
	const seen = new Set<string>();
	for (const path of ownership) {
		if (seen.has(path)) throw new Error("Delegation packet duplicate ownership path");
		seen.add(path);
	}
	return ownership;
}

function section(title: string, values: readonly string[]): string[] {
	return [`## ${title}`, ...values.map((value) => `- ${value}`)];
}

export function buildDelegationPacket(input: PacketInput): string {
	const objective = requiredText("objective", input.objective);
	const ownership = exactOwnershipPaths(input.ownership);
	const interfaces = requiredItems("interfaces", input.interfaces);
	const context = requiredItems("context", input.context);
	const constraints = requiredItems("constraints", input.constraints);
	const verification = requiredItems("verification", input.verification);
	const returnContract = requiredItems("return contract", input.returnContract);
	return [
		"## Objective",
		objective,
		"",
		...section("Ownership", ownership),
		"",
		...section("Interfaces", interfaces),
		"",
		...section("Context", context),
		"",
		...section("Constraints", [...constraints, "Others may edit concurrently; never revert unrelated work."]),
		"",
		...section("Verification", verification),
		"",
		...section("Return Contract", [...returnContract, "Return a structured report to the parent when the owned work is complete."]),
	].join("\n");
}
