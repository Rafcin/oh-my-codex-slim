#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const guidePaths = [
	"README.md",
	"docs/installation.md",
	"docs/architecture.md",
	"docs/opencodex.md",
	"docs/troubleshooting.md",
	"docs/execution-modes.md",
	"docs/agents-and-skills.md",
	"docs/configuration.md",
	"docs/examples.md",
] as const;

const diagramNames = ["omcs-config-precedence", "omcs-pipeline", "omcs-routing"] as const;
const screenshotNames = ["omcs-configure-project.png", "omcs-route-declaration.png", "omcs-verification-receipt.png"] as const;
const maxAssetBytes = 1_000_000;
const minDimension = 320;
const maxDimension = 2_400;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface PublicDocsReport {
	guides: number;
	diagrams: string[];
	screenshots: string[];
}

export interface VerifyPublicDocsOptions {
	repositoryRoot?: string;
}

function fail(message: string): never {
	throw new Error(`documentation-assets: ${message}`);
}

function assertAssetSize(path: string, bytes: Buffer): void {
	if (bytes.byteLength === 0 || bytes.byteLength > maxAssetBytes) fail(`asset has an unsafe size: ${path}`);
}

function titleFromMermaid(source: string, path: string): string {
	const title = /^---\r?\ntitle: ([^\r\n]+)\r?\n---/m.exec(source)?.[1]?.trim();
	if (!title) fail(`Mermaid source has no title: ${path}`);
	return title;
}

function titleFromSvg(source: string, path: string): string {
	if (!/^<\?xml\s+version=/i.test(source) || !/<svg\b[^>]*\bviewBox="0 0 \d+ \d+"[^>]*>/i.test(source)) {
		fail(`SVG is not a bounded XML diagram: ${path}`);
	}
	const title = /<title>([^<]+)<\/title>/i.exec(source)?.[1]?.trim();
	if (!title) fail(`SVG has no title: ${path}`);
	return title;
}

function pngDimensions(bytes: Buffer, path: string): { width: number; height: number } {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) fail(`not a PNG: ${path}`);
	if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") fail(`PNG lacks IHDR: ${path}`);
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assertDimensions(path: string, width: number, height: number): void {
	if (width < minDimension || height < minDimension || width > maxDimension || height > maxDimension) {
		fail(`asset dimensions are outside the public bounds: ${path}`);
	}
}

const unsafeContentPatterns: readonly RegExp[] = [
	/\/Users\/(?!example\/)/i,
	/\b(?:rafszuminski|localhost)\b/i,
	/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
	/\b(?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*\S+/i,
	/\b(?:authorization|cookie)\s*[:=]\s*(?:bearer\s+)?\S+/i,
	/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9]{8,}|github_pat_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]{8,})\b/i,
	/https?:\/\/[^/\s:]+:[^@\s]+@/i,
	/\b(?:openai|anthropic|google|github)_[A-Z0-9_]+\s*=/i,
	/\b[a-z0-9-]+\.(?:internal|local)\b/i,
];

async function collectFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...await collectFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function assertNoUnsafeContent(root: string): Promise<void> {
	const paths = [join(root, "README.md"), ...(await collectFiles(join(root, "docs", "assets")))];
	for (const path of paths) {
		const bytes = await readFile(path);
		const content = bytes.toString("utf8");
		if (unsafeContentPatterns.some((pattern) => pattern.test(content))) {
			fail(`unsafe public documentation content: ${relative(root, path)}`);
		}
	}
}

async function assertReadmeLinks(root: string): Promise<void> {
	const readme = await readFile(join(root, "README.md"), "utf8");
	for (const guide of guidePaths.slice(1)) {
		const target = guide.replace(/^docs\//, "docs/");
		if (!readme.includes(`](${target})`)) fail(`README does not link required guide: ${target}`);
	}
	for (const asset of ["omcs-pipeline.svg", ...screenshotNames]) {
		if (!readme.includes(`docs/assets/${asset}`)) fail(`README does not embed required asset: ${asset}`);
	}
}

export async function verifyPublicDocs(options: VerifyPublicDocsOptions = {}): Promise<PublicDocsReport> {
	const root = resolve(options.repositoryRoot ?? repositoryRoot);
	await assertNoUnsafeContent(root);
	for (const guide of guidePaths) await stat(join(root, guide));
	await assertReadmeLinks(root);

	for (const diagram of diagramNames) {
		const sourcePath = join(root, "docs", "diagrams", `${diagram}.mmd`);
		const svgPath = join(root, "docs", "assets", `${diagram}.svg`);
		const source = await readFile(sourcePath, "utf8");
		const svg = await readFile(svgPath, "utf8");
		assertAssetSize(svgPath, Buffer.from(svg));
		if (titleFromMermaid(source, sourcePath) !== titleFromSvg(svg, svgPath)) fail(`diagram titles do not match: ${diagram}`);
	}

	for (const screenshot of screenshotNames) {
		const path = join(root, "docs", "assets", screenshot);
		const bytes = await readFile(path);
		assertAssetSize(path, bytes);
		const { width, height } = pngDimensions(bytes, path);
		assertDimensions(path, width, height);
	}

	return { guides: guidePaths.length, diagrams: [...diagramNames], screenshots: [...screenshotNames] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const report = await verifyPublicDocs();
	process.stdout.write(`verified ${report.guides} guides, ${report.diagrams.length} diagrams, and ${report.screenshots.length} screenshots\n`);
}
