import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	opendir,
	readFile,
	readlink,
	realpath,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { BenchmarkSuite } from "./manifest.js";

export const graderImage =
	"node@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c";

export interface BenchmarkTaskProvenance {
	fixtureSha256: string;
	graderSha256: string;
	promptSha256: string;
}

export interface BenchmarkProvenance {
	suiteSha256: string;
	codexCliVersion: string;
	omcsPackageVersion: string;
	omcsPluginSha256: string;
	omcsRuntimeSha256: string;
	benchmarkHarnessSha256: string;
	nodeRuntimeSha256: string;
	nodeVersion: string;
	graderImage: string;
	tasks: Record<string, BenchmarkTaskProvenance>;
}

export interface BenchmarkSnapshot {
	root: string;
	fixtures: Map<string, string>;
	provenance: BenchmarkProvenance;
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function contained(root: string, candidate: string): boolean {
	const path = relative(resolve(root), resolve(candidate));
	return path !== ".." && !path.startsWith(`..${sep}`);
}

async function regularFiles(root: string): Promise<string[]> {
	const status = await lstat(root);
	if (status.isSymbolicLink()) throw new Error("benchmark assets may not be symbolic links");
	if (status.isFile()) {
		if (status.nlink !== 1) throw new Error("benchmark assets may not be hard linked");
		return [root];
	}
	if (!status.isDirectory())
		throw new Error("benchmark assets must be regular files or directories");
	const files: string[] = [];
	const directory = await opendir(root);
	for await (const entry of directory)
		files.push(...(await regularFiles(join(root, entry.name))));
	return files.sort();
}

async function treeDigest(root: string): Promise<string> {
	const files = await regularFiles(root);
	const hash = createHash("sha256");
	for (const path of files) {
		hash.update(relative(root, path).replaceAll(sep, "/"));
		hash.update("\0");
		hash.update(await readFile(path));
		hash.update("\0");
	}
	return hash.digest("hex");
}

async function selectedTreeDigest(
	packageRoot: string,
	relativePaths: string[],
): Promise<string> {
	const hash = createHash("sha256");
	for (const relativePath of relativePaths) {
		const root = join(packageRoot, relativePath);
		const files = await regularFiles(root);
		for (const path of files) {
			hash.update(relative(packageRoot, path).replaceAll(sep, "/"));
			hash.update("\0");
			hash.update(await readFile(path));
			hash.update("\0");
		}
	}
	return hash.digest("hex");
}

async function runtimeClosureDigest(packageRoot: string): Promise<string> {
	const hash = createHash("sha256");
	const visit = async (
		path: string,
		skipNestedNodeModules = false,
	): Promise<void> => {
		const status = await lstat(path);
		const relativePath = relative(packageRoot, path).replaceAll(sep, "/");
		if (status.isSymbolicLink()) {
			const target = await realpath(path);
			if (!contained(packageRoot, target))
				throw new Error("benchmark runtime symlink escapes the package root");
			hash.update(`link\0${relativePath}\0${await readlink(path)}\0`);
			return;
		}
		if (status.isFile()) {
			hash.update(`file\0${relativePath}\0`);
			hash.update(await readFile(path));
			hash.update("\0");
			return;
		}
		if (!status.isDirectory())
			throw new Error("benchmark runtime contains an unsupported file type");
		hash.update(`directory\0${relativePath}\0`);
		const entries: string[] = [];
		const directory = await opendir(path);
		for await (const entry of directory) {
			if (!(skipNestedNodeModules && entry.name === "node_modules"))
				entries.push(entry.name);
		}
		for (const entry of entries.sort())
			await visit(join(path, entry), skipNestedNodeModules);
	};
	for (const relativePath of [
		"package.json",
		".agents/plugins/marketplace.json",
		"plugins/oh-my-codex-slim",
		"dist",
	])
		await visit(join(packageRoot, relativePath));

	type DependencyDocument = {
		dependencies?: Record<string, unknown>;
		optionalDependencies?: Record<string, unknown>;
		peerDependencies?: Record<string, unknown>;
	};
	const nodeModulesRoot = join(packageRoot, "node_modules");
	const seenPackages = new Set<string>();
	const resolveInstalledPackage = async (
		fromDirectory: string,
		name: string,
	): Promise<string | undefined> => {
		let cursor = fromDirectory;
		while (contained(packageRoot, cursor)) {
			const candidate = join(cursor, "node_modules", ...name.split("/"));
			try {
				const canonical = await realpath(candidate);
				const status = await lstat(canonical);
				if (!contained(nodeModulesRoot, canonical) || !status.isDirectory())
					throw new Error("benchmark dependency escaped node_modules");
				return canonical;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (resolve(cursor) === resolve(packageRoot)) break;
			cursor = dirname(cursor);
		}
		return undefined;
	};
	const visitPackage = async (
		name: string,
		fromDirectory: string,
		required: boolean,
	): Promise<void> => {
		const directory = await resolveInstalledPackage(fromDirectory, name);
		if (!directory) {
			if (required)
				throw new Error(`benchmark runtime dependency is unavailable: ${name}`);
			return;
		}
		if (seenPackages.has(directory)) return;
		seenPackages.add(directory);
		await visit(directory, true);
		const document = JSON.parse(
			await readFile(join(directory, "package.json"), "utf8"),
		) as DependencyDocument;
		for (const dependency of Object.keys(document.dependencies ?? {}).sort())
			await visitPackage(dependency, directory, true);
		for (const dependency of Object.keys(
			document.optionalDependencies ?? {},
		).sort())
			await visitPackage(dependency, directory, false);
		for (const dependency of Object.keys(document.peerDependencies ?? {}).sort())
			await visitPackage(dependency, directory, false);
	};
	const rootDocument = JSON.parse(
		await readFile(join(packageRoot, "package.json"), "utf8"),
	) as DependencyDocument;
	for (const dependency of Object.keys(rootDocument.dependencies ?? {}).sort())
		await visitPackage(dependency, packageRoot, true);
	for (const dependency of Object.keys(
		rootDocument.optionalDependencies ?? {},
	).sort())
		await visitPackage(dependency, packageRoot, false);
	try {
		await visit(join(packageRoot, "package-lock.json"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return hash.digest("hex");
}

async function provenanceDigests(packageRoot: string): Promise<{
	omcsPluginSha256: string;
	omcsRuntimeSha256: string;
	benchmarkHarnessSha256: string;
	nodeRuntimeSha256: string;
	nodeVersion: string;
}> {
	return {
		omcsPluginSha256: await selectedTreeDigest(packageRoot, [
			".agents/plugins/marketplace.json",
			"plugins/oh-my-codex-slim",
			"dist/agents/catalog.js",
			"dist/agents/install.js",
		]),
		omcsRuntimeSha256: await runtimeClosureDigest(packageRoot),
		benchmarkHarnessSha256: await selectedTreeDigest(packageRoot, [
			"dist/benchmark",
			"dist/cli/benchmark.js",
		]),
		nodeRuntimeSha256: sha256(await readFile(process.execPath)),
		nodeVersion: process.version,
	};
}

export async function inspectBenchmarkSnapshot(options: {
	suite: BenchmarkSuite;
	snapshotRoot: string;
	codexCliVersion: string;
	omcsPackageVersion: string;
	packageRoot: string;
}): Promise<BenchmarkSnapshot> {
	const digests = await provenanceDigests(options.packageRoot);
	const fixtures = new Map<string, string>();
	const tasks: Record<string, BenchmarkTaskProvenance> = {};
	for (const task of options.suite.tasks) {
		const fixture = join(options.snapshotRoot, "fixtures", task.id);
		fixtures.set(task.id, fixture);
		const graderHash = createHash("sha256");
		for (const asset of [...task.graderAssets].sort()) {
			const path = join(options.snapshotRoot, "suite", asset);
			const status = await lstat(path);
			if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1)
				throw new Error("benchmark snapshot grader assets are invalid");
			graderHash.update(asset);
			graderHash.update("\0");
			graderHash.update(await readFile(path));
			graderHash.update("\0");
		}
		tasks[task.id] = {
			fixtureSha256: await treeDigest(fixture),
			graderSha256: graderHash.digest("hex"),
			promptSha256: sha256(task.prompt),
		};
	}
	return {
		root: options.snapshotRoot,
		fixtures,
		provenance: {
			suiteSha256: sha256(JSON.stringify(options.suite)),
			codexCliVersion: options.codexCliVersion,
			omcsPackageVersion: options.omcsPackageVersion,
			...digests,
			graderImage,
			tasks,
		},
	};
}

export async function snapshotBenchmarkSuite(options: {
	suite: BenchmarkSuite;
	suiteRoot: string;
	destination: string;
	codexCliVersion: string;
	omcsPackageVersion: string;
	packageRoot: string;
}): Promise<BenchmarkSnapshot> {
	const digests = await provenanceDigests(options.packageRoot);
	const suiteRoot = await realpath(options.suiteRoot);
	await mkdir(options.destination, { recursive: false, mode: 0o700 });
	const fixtures = new Map<string, string>();
	const tasks: Record<string, BenchmarkTaskProvenance> = {};
	const copiedAssets = new Set<string>();

	for (const task of options.suite.tasks) {
		const fixtureSource = resolve(suiteRoot, task.fixture);
		if (!contained(suiteRoot, fixtureSource))
			throw new Error("benchmark fixture must stay inside the suite root");
		await regularFiles(fixtureSource);
		const fixtureDestination = join(options.destination, "fixtures", task.id);
		await mkdir(dirname(fixtureDestination), { recursive: true, mode: 0o700 });
		await cp(fixtureSource, fixtureDestination, {
			recursive: true,
			errorOnExist: true,
			force: false,
		});
		fixtures.set(task.id, fixtureDestination);

		const graderHash = createHash("sha256");
		for (const asset of [...task.graderAssets].sort()) {
			const source = resolve(suiteRoot, asset);
			if (!contained(suiteRoot, source))
				throw new Error("benchmark grader asset must stay inside the suite root");
			const status = await lstat(source);
			if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1)
				throw new Error("benchmark grader assets must be unique regular files");
			const bytes = await readFile(source);
			graderHash.update(asset);
			graderHash.update("\0");
			graderHash.update(bytes);
			graderHash.update("\0");
			if (!copiedAssets.has(asset)) {
				const destination = join(options.destination, "suite", asset);
				await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
				await cp(source, destination, { errorOnExist: true, force: false });
				copiedAssets.add(asset);
			}
		}
		tasks[task.id] = {
			fixtureSha256: await treeDigest(fixtureDestination),
			graderSha256: graderHash.digest("hex"),
			promptSha256: sha256(task.prompt),
		};
	}

	return {
		root: options.destination,
		fixtures,
		provenance: {
			suiteSha256: sha256(JSON.stringify(options.suite)),
			codexCliVersion: options.codexCliVersion,
			omcsPackageVersion: options.omcsPackageVersion,
			...digests,
			graderImage,
			tasks,
		},
	};
}
