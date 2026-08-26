export interface PacketObjective {
	task: string;
	observableOutcome: string;
}

export interface PacketInterfaces {
	requirements: readonly string[];
	compatibilityRequirements: readonly string[];
}

export interface PacketConstraints {
	requirements: readonly string[];
	exclusions: readonly string[];
}

export interface PacketVerification {
	command: string;
	expectedEvidence: string;
}

export interface PacketReturnContract {
	reportFields: readonly string[];
}

export interface PacketInput {
	objective: PacketObjective;
	ownership: readonly string[];
	interfaces: PacketInterfaces;
	context: readonly string[];
	constraints: PacketConstraints;
	verification: readonly PacketVerification[];
	returnContract: PacketReturnContract;
}

const MAX_PACKET_TEXT_LENGTH = 500;
const UNSAFE_PACKET_TEXT = /[\u0000-\u001F\u007F]/;

function requiredText(label: string, value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`Delegation packet ${label} must not be empty`);
	if (normalized.length > MAX_PACKET_TEXT_LENGTH) throw new Error(`Delegation packet ${label} exceeds ${MAX_PACKET_TEXT_LENGTH} characters`);
	if (UNSAFE_PACKET_TEXT.test(normalized)) throw new Error(`Delegation packet ${label} contains unsafe characters`);
	return normalized;
}

function requiredItems(label: string, values: readonly string[]): string[] {
	if (!Array.isArray(values) || values.length === 0) throw new Error(`Delegation packet ${label} must not be empty`);
	return values.map((value) => requiredText(label, value));
}

function normalizeOwnershipPath(value: string): string {
	const path = requiredText("ownership path", value);
	if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
		throw new Error("Delegation packet ownership path must be a relative POSIX path");
	}

	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) throw new Error("Delegation packet ownership path must not escape the workspace");
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (segments.length === 0) throw new Error("Delegation packet ownership path must not be empty or the workspace root");
	return segments.join("/");
}

function exactOwnershipPaths(values: readonly string[]): string[] {
	if (!Array.isArray(values) || values.length === 0) throw new Error("Delegation packet ownership must not be empty");
	const seen = new Set<string>();
	return values.map((value) => {
		const path = normalizeOwnershipPath(value);
		if (seen.has(path)) throw new Error("Delegation packet duplicate ownership path");
		seen.add(path);
		return path;
	});
}

function section(title: string, values: readonly string[]): string[] {
	return [`## ${title}`, ...values.map((value) => `- ${value}`)];
}

export function buildDelegationPacket(input: PacketInput): string {
	const objective = {
		task: requiredText("objective task", input.objective.task),
		observableOutcome: requiredText("observable outcome", input.objective.observableOutcome),
	};
	const ownership = exactOwnershipPaths(input.ownership);
	const interfaces = {
		requirements: requiredItems("interface requirements", input.interfaces.requirements),
		compatibilityRequirements: requiredItems("compatibility requirements", input.interfaces.compatibilityRequirements),
	};
	const context = requiredItems("context", input.context);
	const constraints = {
		requirements: requiredItems("constraint requirements", input.constraints.requirements),
		exclusions: requiredItems("exclusions", input.constraints.exclusions),
	};
	if (!Array.isArray(input.verification) || input.verification.length === 0) {
		throw new Error("Delegation packet verification must not be empty");
	}
	const verification = input.verification.map((step) => ({
		command: requiredText("verification command", step.command),
		expectedEvidence: requiredText("expected evidence", step.expectedEvidence),
	}));
	const returnContract = requiredItems("return contract", input.returnContract.reportFields);

	return [
		...section("Objective", [
			`Task: ${objective.task}`,
			`Observable outcome: ${objective.observableOutcome}`,
		]),
		"",
		...section("Ownership", ownership),
		"",
		...section("Interfaces", [
			...interfaces.requirements.map((requirement) => `Requirement: ${requirement}`),
			...interfaces.compatibilityRequirements.map((requirement) => `Compatibility: ${requirement}`),
		]),
		"",
		...section("Context", context),
		"",
		...section("Constraints", [
			...constraints.requirements.map((requirement) => `Requirement: ${requirement}`),
			...constraints.exclusions.map((exclusion) => `Exclusion: ${exclusion}`),
			"Others may edit concurrently; never revert unrelated work.",
		]),
		"",
		...section("Verification", verification.flatMap((step) => [
			`Command: ${step.command}`,
			`Expected evidence: ${step.expectedEvidence}`,
		])),
		"",
		...section("Return Contract", [
			`Return a structured report to the parent with: ${returnContract.join("; ")}.`,
		]),
	].join("\n");
}
