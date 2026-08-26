#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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
	pngReviewManifest?: PngReviewManifest;
}

export interface PngReviewFixture {
	sha256: string;
	visibleText: readonly string[];
}

export type PngReviewManifest = Readonly<Record<(typeof screenshotNames)[number], PngReviewFixture>>;

/** Exact reviewed fixture bytes bind this text-only manifest to the rendered screenshots. */
export const REVIEWED_PNG_FIXTURES: PngReviewManifest = {
	"omcs-configure-project.png": {
		sha256: "c87d603361e1e4b00a058352bbf1b1ca2c3f193d3e4ba9237b20a4c75d182696",
		visibleText: [
			"acme-widget — zsh", "/Users/example/acme-widget", "omcs configure --scope project --profile auto --dry-run --json",
			"scope: project", "action: would-create", "path: /Users/example/acme-widget/omcs.config.json", "bytes: 363", "effectiveProfile: auto",
			"omcs configure --scope project --profile auto --json", "scope: project", "action: create", "bytes: 363", "effectiveProfile: auto",
		],
	},
	"omcs-route-declaration.png": {
		sha256: "6dd535368485a38d3d9c4c702efd492f64c16742b564a14662b48b9aa5660e27",
		visibleText: [
			"acme-widget — Codex CLI", "/Users/example/acme-widget", "Use OMCS to solve this issue", "OMCS ROUTE", "profile: auto", "mode: full",
			"risk: public interface with persistent configuration", "skills: context, codebase-design, plan, tdd, verification, code-review",
			"agents: architect → explorer + librarian → terra-fixer → reviewer", "approval: material-decisions",
		],
	},
	"omcs-verification-receipt.png": {
		sha256: "c002ca9e4744144f8ad6a9329e249c78331a70bc8c9be5b6b59985089d7c5828",
		visibleText: [
			"acme-widget — synthetic receipt fixture", "/Users/example/acme-widget",
			".omcs/runs/2026-08-26T12-00-00-000Z-12345678-1234-4abc-8def-1234567890ab.json", "schemaVersion: 1", "profile: auto", "route: full",
			"skills: tdd, verification", "agents: omcs_architect, omcs_reviewer", "approval: material-decisions", "command: npm test", "outcome: passed", "verdict: ship",
		],
	},
};

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

interface XmlElement {
	name: string;
	attributes: Record<string, string>;
	children: XmlElement[];
	text: string;
}

function readTagEnd(source: string, start: number): number {
	let quote: "\"" | "'" | undefined;
	for (let index = start; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (char === quote) quote = undefined;
		} else if (char === "\"" || char === "'") quote = char;
		else if (char === ">") return index;
	}
	fail("SVG is not well-formed XML: unterminated tag");
}

function parseAttributes(source: string, path: string): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
	const trimmed = source.trim();
	const selfClosing = trimmed.endsWith("/");
	const content = (selfClosing ? trimmed.slice(0, -1) : trimmed).trim();
	const name = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(content)?.[0];
	if (!name) fail(`SVG is not well-formed XML: invalid element in ${path}`);
	const attributes: Record<string, string> = {};
	let index = name.length;
	while (index < content.length) {
		while (/\s/.test(content[index] ?? "")) index += 1;
		if (index === content.length) break;
		const attribute = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(content.slice(index))?.[0];
		if (!attribute || attributes[attribute] !== undefined) fail(`SVG is not well-formed XML: invalid attribute in ${path}`);
		index += attribute.length;
		while (/\s/.test(content[index] ?? "")) index += 1;
		if (content[index] !== "=") fail(`SVG is not well-formed XML: missing attribute value in ${path}`);
		index += 1;
		while (/\s/.test(content[index] ?? "")) index += 1;
		const quote = content[index];
		if (quote !== "\"" && quote !== "'") fail(`SVG is not well-formed XML: unquoted attribute in ${path}`);
		const end = content.indexOf(quote, index + 1);
		if (end < 0) fail(`SVG is not well-formed XML: unterminated attribute in ${path}`);
		attributes[attribute] = content.slice(index + 1, end);
		index = end + 1;
	}
	return { name, attributes, selfClosing };
}

/** Parses the small, inert SVG subset we ship and rejects malformed XML structurally. */
export function parseSvgDiagram(source: string, path: string): { title: string; width: number; height: number } {
	if (!source.startsWith("<?xml")) fail(`SVG is not well-formed XML: missing declaration in ${path}`);
	const stack: XmlElement[] = [];
	let root: XmlElement | undefined;
	let index = 0;
	while (index < source.length) {
		const next = source.indexOf("<", index);
		if (next < 0) {
			if (source.slice(index).trim() !== "") fail(`SVG is not well-formed XML: trailing text in ${path}`);
			break;
		}
		if (next > index) {
			const current = stack.at(-1);
			if (current) current.text += source.slice(index, next);
		}
		if (source.startsWith("<?", next)) {
			const end = source.indexOf("?>", next + 2);
			if (end < 0) fail(`SVG is not well-formed XML: unterminated declaration in ${path}`);
			index = end + 2;
			continue;
		}
		if (source.startsWith("<!--", next)) {
			const end = source.indexOf("-->", next + 4);
			if (end < 0) fail(`SVG is not well-formed XML: unterminated comment in ${path}`);
			index = end + 3;
			continue;
		}
		if (source.startsWith("<![CDATA[", next)) {
			const end = source.indexOf("]]>", next + 9);
			if (end < 0 || stack.length === 0) fail(`SVG is not well-formed XML: invalid CDATA in ${path}`);
			const current = stack.at(-1);
			if (current) current.text += source.slice(next + 9, end);
			index = end + 3;
			continue;
		}
		if (source.startsWith("</", next)) {
			const end = source.indexOf(">", next + 2);
			const name = source.slice(next + 2, end).trim();
			const current = stack.pop();
			if (end < 0 || !current || current.name !== name) fail(`SVG is not well-formed XML: mismatched close tag in ${path}`);
			index = end + 1;
			continue;
		}
		if (source.startsWith("<!", next)) fail(`SVG is not well-formed XML: unsupported declaration in ${path}`);
		const end = readTagEnd(source, next + 1);
		const parsed = parseAttributes(source.slice(next + 1, end), path);
		const node: XmlElement = { name: parsed.name, attributes: parsed.attributes, children: [], text: "" };
		if (stack.length === 0) {
			if (root) fail(`SVG is not well-formed XML: multiple roots in ${path}`);
			root = node;
		} else stack.at(-1)?.children.push(node);
		if (!parsed.selfClosing) stack.push(node);
		index = end + 1;
	}
	if (!root || stack.length !== 0 || root.name !== "svg") fail(`SVG is not well-formed XML: incomplete SVG root in ${path}`);
	const title = root.children.find((child) => child.name === "title")?.text.trim();
	const viewBox = root.attributes.viewBox?.split(/\s+/).map(Number);
	if (!title || !viewBox || viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0 || !Number.isFinite(viewBox[2]) || !Number.isFinite(viewBox[3])) {
		fail(`SVG is not a bounded XML diagram: ${path}`);
	}
	return { title, width: viewBox[2], height: viewBox[3] };
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

function assertSafeReviewedText(name: string, fixture: PngReviewFixture): void {
	if (!/^[a-f0-9]{64}$/.test(fixture.sha256) || fixture.visibleText.length === 0) fail(`invalid PNG review manifest: ${name}`);
	if (unsafeContentPatterns.some((pattern) => fixture.visibleText.some((value) => pattern.test(value)))) fail(`unsafe reviewed PNG text: ${name}`);
}

async function assertReviewedPng(root: string, name: (typeof screenshotNames)[number], fixture: PngReviewFixture): Promise<void> {
	assertSafeReviewedText(name, fixture);
	const bytes = await readFile(join(root, "docs", "assets", name));
	if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) fail(`reviewed digest does not match: ${name}`);
}

function packagePaths(root: string): Set<string> {
	const packed = spawnSync("npm", ["pack", "--json", "--dry-run"], { cwd: root, encoding: "utf8" });
	if (packed.status !== 0) fail(`unable to inspect npm package: ${packed.stderr || packed.stdout}`);
	try {
		const value = JSON.parse(packed.stdout) as Array<{ files?: Array<{ path?: unknown }> }>;
		return new Set(value[0]?.files?.map((file) => file.path).filter((path): path is string => typeof path === "string") ?? []);
	} catch { fail("unable to parse npm package inspection"); }
}

async function assertPackagedReadmeLinks(root: string): Promise<void> {
	const readmePath = join(root, "README.md");
	const links = (await readFile(readmePath, "utf8")).matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g);
	const packaged = packagePaths(root);
	for (const match of links) {
		const target = match[1]?.split("#", 1)[0] ?? "";
		if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
		const candidate = relative(root, resolve(dirname(readmePath), target));
		if (candidate === "" || candidate.startsWith("..")) fail(`README has an unsafe relative link: ${target}`);
		if (!packaged.has(candidate)) fail(`README link is not packaged: ${target}`);
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
	const pngReviewManifest = options.pngReviewManifest ?? REVIEWED_PNG_FIXTURES;
	await assertNoUnsafeContent(root);
	for (const guide of guidePaths) await stat(join(root, guide));
	await assertReadmeLinks(root);
	await assertPackagedReadmeLinks(root);

	for (const diagram of diagramNames) {
		const sourcePath = join(root, "docs", "diagrams", `${diagram}.mmd`);
		const svgPath = join(root, "docs", "assets", `${diagram}.svg`);
		const source = await readFile(sourcePath, "utf8");
		const svg = await readFile(svgPath, "utf8");
		assertAssetSize(svgPath, Buffer.from(svg));
		if (titleFromMermaid(source, sourcePath) !== parseSvgDiagram(svg, svgPath).title) fail(`diagram titles do not match: ${diagram}`);
	}

	for (const screenshot of screenshotNames) {
		const path = join(root, "docs", "assets", screenshot);
		const bytes = await readFile(path);
		assertAssetSize(path, bytes);
		const { width, height } = pngDimensions(bytes, path);
		assertDimensions(path, width, height);
		await assertReviewedPng(root, screenshot, pngReviewManifest[screenshot]);
	}

	return { guides: guidePaths.length, diagrams: [...diagramNames], screenshots: [...screenshotNames] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const report = await verifyPublicDocs();
	process.stdout.write(`verified ${report.guides} guides, ${report.diagrams.length} diagrams, and ${report.screenshots.length} screenshots\n`);
}
