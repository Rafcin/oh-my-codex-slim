import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { executeBenchmark } from "../benchmark/execution.js";
import { parseBenchmarkSuite } from "../benchmark/manifest.js";
import { planBenchmark } from "../benchmark/plan.js";
import { snapshotBenchmarkSuite } from "../benchmark/snapshot.js";
import {
	parseBenchmarkResults,
	summarizeBenchmark,
} from "../benchmark/report.js";

const maxJsonBytes = 1_000_000;
const execFileAsync = promisify(execFile);

async function readBoundedJson(
	path: string,
): Promise<{ path: string; value: unknown }> {
	const canonical = await realpath(path);
	const status = await lstat(path);
	if (
		status.isSymbolicLink() ||
		!status.isFile() ||
		status.size <= 0 ||
		status.size > maxJsonBytes
	) {
		throw new Error("benchmark input must be a bounded regular file");
	}
	return {
		path: canonical,
		value: JSON.parse(await readFile(canonical, "utf8")) as unknown,
	};
}

export async function planBenchmarkFile(
	path: string,
): Promise<ReturnType<typeof planBenchmark>> {
	const input = await readBoundedJson(path);
	const suite = parseBenchmarkSuite(input.value);
	const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
	const packageDocument = JSON.parse(
		await readFile(join(packageRoot, "package.json"), "utf8"),
	) as { version?: unknown };
	if (typeof packageDocument.version !== "string")
		throw new Error("OMCS package version is unavailable");
	let codexCliVersion = "unavailable-at-plan-time";
	try {
		const { stdout } = await execFileAsync("codex", ["--version"], {
			encoding: "utf8",
			timeout: 30_000,
		});
		codexCliVersion = stdout.trim() || codexCliVersion;
	} catch {
		// Planning is non-executing; the billed run re-probes and freezes the exact CLI.
	}
	const scratch = await mkdtemp(join(tmpdir(), "omcs-benchmark-plan-"));
	try {
		const snapshot = await snapshotBenchmarkSuite({
			suite,
			suiteRoot: dirname(input.path),
			destination: join(scratch, "snapshot"),
			codexCliVersion,
			omcsPackageVersion: packageDocument.version,
			packageRoot,
		});
		return planBenchmark(suite, snapshot.provenance);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

export async function dryRunBenchmarkFile(path: string): Promise<{
	modelExecution: false;
	billedApprovalRequired: true;
	plan: ReturnType<typeof planBenchmark>;
}> {
	return {
		modelExecution: false,
		billedApprovalRequired: true,
		plan: await planBenchmarkFile(path),
	};
}

export async function executeBenchmarkFile(path: string, resumeDirectory?: string): Promise<{
	modelExecution: true;
	resultPath: string;
	report: ReturnType<typeof summarizeBenchmark>;
}> {
	const input = await readBoundedJson(path);
	const suite = parseBenchmarkSuite(input.value);
	const result = await executeBenchmark({
		suite,
		suiteRoot: dirname(input.path),
		outputRoot: join(process.cwd(), ".omcs", "benchmarks"),
		approval: { execute: true, approveModelUsage: true },
		resumeDirectory,
	});
	return {
		modelExecution: true,
		resultPath: result.resultPath,
		report: summarizeBenchmark(result),
	};
}

export async function reportBenchmarkFile(
	path: string,
): Promise<ReturnType<typeof summarizeBenchmark>> {
	const input = await readBoundedJson(path);
	return summarizeBenchmark(parseBenchmarkResults(input.value));
}
