export interface CodexInvocationInput {
	kind: "codex-default" | "omcs";
	profile?: "auto" | "fast" | "thorough";
	model: string;
	reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
	sandbox: "read-only" | "workspace-write";
	workingDirectory: string;
	toolDirectory: string;
	readableRoots?: readonly string[];
	prompt: string;
}

export interface CodexInvocation {
	command: "codex";
	args: string[];
	stdin: string;
}

export interface ExecutionApproval {
	execute: boolean;
	approveModelUsage: boolean;
}

export function assertExecutionApproved(approval: ExecutionApproval): void {
	if (!approval.execute)
		throw new Error("benchmark execution requires --execute");
	if (!approval.approveModelUsage)
		throw new Error("benchmark execution requires --approve-model-usage");
}

/** Builds a prompt-on-stdin invocation so task text never appears in process listings. */
export function buildCodexInvocation(
	input: CodexInvocationInput,
): CodexInvocation {
	const projectAccess = input.sandbox === "workspace-write" ? "write" : "read";
	const treatmentArgs =
		input.kind === "codex-default"
			? [
					"--ignore-user-config",
					"--ignore-rules",
					"--disable",
					"plugins",
					"--disable",
					"hooks",
				]
			: ["--ignore-rules"];
	const prompt =
		input.kind === "omcs"
			? `Use OMCS with the ${input.profile ?? "auto"} profile.\n\n${input.prompt}`
			: input.prompt;
	const filesystemEntries = [
		'":minimal"="read"',
		`":project_roots"="${projectAccess}"`,
		`${JSON.stringify(input.toolDirectory)}="read"`,
		...[...new Set(input.readableRoots ?? [])].map(
			(root) => `${JSON.stringify(root)}="read"`,
		),
	];
	return {
		command: "codex",
		args: [
			"--ask-for-approval",
			"never",
			"-c",
			'default_permissions="omcs-benchmark"',
			"-c",
			`permissions.omcs-benchmark.filesystem={${filesystemEntries.join(",")}}`,
			"-c",
			"permissions.omcs-benchmark.network.enabled=false",
			"-c",
			'shell_environment_policy.inherit="core"',
			"-c",
			'shell_environment_policy.exclude=["*_KEY","*_TOKEN","*_SECRET","*_PASSWORD","CODEX_HOME"]',
			"exec",
			"--json",
			"--ephemeral",
			"--sandbox",
			input.sandbox,
			...treatmentArgs,
			"--model",
			input.model,
			"-c",
			`model_reasoning_effort="${input.reasoningEffort}"`,
			"--cd",
			input.workingDirectory,
			"-",
		],
		stdin: prompt,
	};
}
