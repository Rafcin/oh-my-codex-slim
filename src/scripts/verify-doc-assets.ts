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
	"docs/benchmarking.md",
] as const;

const diagramNames = ["omcs-config-precedence", "omcs-pipeline", "omcs-routing"] as const;
const chartNames = ["omcs-benchmark-calibration", "omcs-benchmark-results", "omcs-benchmark-task-outcomes"] as const;
const terminalNames = ["omcs-configure-project.svg", "omcs-route-declaration.svg", "omcs-verification-receipt.svg"] as const;
const maxAssetBytes = 1_000_000;
const minDimension = 320;
const maxDimension = 2_400;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const monochromePalette = new Set(["#111111", "#525252", "#A3A3A3", "#E5E5E5", "#F5F5F5", "#FFFFFF", "NONE"]);
const benchmarkPalette = new Set([...monochromePalette, "#1E8CF4"]);
const benchmarkElements = new Set(["svg", "title", "desc", "rect", "line", "text", "g"]);
const benchmarkAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
	svg: new Set(["xmlns", "viewBox", "role", "aria-labelledby"]),
	title: new Set(["id"]),
	desc: new Set(["id"]),
	rect: new Set(["x", "y", "width", "height", "rx", "fill", "stroke", "stroke-width"]),
	line: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width"]),
	text: new Set(["x", "y", "text-anchor", "font-family", "font-size", "font-weight", "fill"]),
	g: new Set(["font-family", "font-size"]),
};
const terminalPalette = new Set([
	"#00CA4E", "#171717", "#202020", "#303030", "#525252", "#7DD3C7", "#A3A3A3", "#A7F3D0", "#B7A7FF",
	"#D4D4D4", "#E5E5E5", "#F5F5F5", "#F7F7F5", "#FDE68A", "#FF605C", "#FFBD44", "NONE",
]);
const terminalElements = new Set(["svg", "title", "desc", "rect", "path", "line", "circle", "text", "g"]);
const terminalAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
	svg: new Set(["xmlns", "viewBox", "role", "aria-labelledby"]),
	title: new Set(["id"]),
	desc: new Set(["id"]),
	rect: new Set(["x", "y", "width", "height", "rx", "fill", "stroke", "stroke-width"]),
	path: new Set(["d", "fill"]),
	line: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width"]),
	circle: new Set(["cx", "cy", "r", "fill"]),
	text: new Set(["x", "y", "text-anchor", "font-family", "font-size", "font-weight", "fill", "dominant-baseline"]),
	g: new Set(["font-family", "font-size", "dominant-baseline"]),
};

export interface PublicDocsReport {
	guides: number;
	diagrams: string[];
	charts: string[];
	terminals: string[];
}

export interface VerifyPublicDocsOptions {
	repositoryRoot?: string;
	terminalReviewManifest?: TerminalReviewManifest;
}

export interface TerminalReviewFixture {
	sha256: string;
	visibleText: readonly string[];
}

export type TerminalReviewManifest = Readonly<Record<(typeof terminalNames)[number], TerminalReviewFixture>>;

/** Exact reviewed fixture bytes bind this transcription to the published terminal SVGs. */
export const REVIEWED_TERMINAL_FIXTURES: TerminalReviewManifest = {
	"omcs-configure-project.svg": {
		sha256: "67f77e2d08f404b695f5e0092152c0c8d684ea19db69608bedc1d8ac26fd8c5f",
		visibleText: [
			"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$",
			"omcs configure --scope project --profile auto --dry-run --json", "{", '"scope": "project",', '"action": "would-create",',
			'"path": "/Users/example/acme-widget/omcs.config.json",', '"bytes": 398,', '"effectiveProfile": "auto"', "}", "dry run only · no project file was written",
		],
	},
	"omcs-route-declaration.svg": {
		sha256: "02c9849833ccb28e67fc43e99f985c39ec44f3b87446697ecc7e47224e32e79d",
		visibleText: [
			"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$", "Use OMCS to solve this issue", "OMCS ROUTE", "profile: auto", "mode: full",
			"risk: wide blast radius; review required", "skills: context · codebase-design · plan · tdd · ai-slop-cleaner · verification · code-review",
			"agents: architect → explorer + librarian → terra-fixer → reviewer", "council: disabled", "approval: material-decisions", "understanding complete", "design ready for approval", "implementation pending",
		],
	},
	"omcs-verification-receipt.svg": {
		sha256: "8b9fc5fb1acc7ed8f30074c7baa0311c685815266ce08fc97eba2931d55bef14",
		visibleText: [
			"acme-widget — Codex CLI", "example@acme-widget", "~/work/acme-widget", "$", "cat ./.omcs/runs/<receipt>.json", "{", '"schemaVersion": 1,', '"profile": "auto",', '"route": "full",',
			'"skills": ["tdd", "verification"],', '"agents": ["omcs_architect", "omcs_reviewer"],', '"approval": "material-decisions",',
			'"verification": [{"command": "npm test", "outcome": "passed"}],', '"review": {"verdict": "ship"}', "}", "verification: npm test passed · review: ship",
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

function assertDimensions(path: string, width: number, height: number): void {
	if (width < minDimension || height < minDimension || width > maxDimension || height > maxDimension) {
		fail(`asset dimensions are outside the public bounds: ${path}`);
	}
}

/** Keeps public diagrams in the reviewed neutral palette without hidden CSS escape hatches. */
export function assertMonochromeSvg(source: string, path: string): void {
	if (/<(?:linearGradient|radialGradient|filter|style)\b|\sstyle\s*=/i.test(source)) {
		fail(`SVG is not monochrome: decorative effect or style escape in ${path}`);
	}
	const colorAttributes = source.matchAll(/\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*=\s*(["'])(.*?)\1/gi);
	for (const match of colorAttributes) {
		const value = match[2]?.trim().toUpperCase() ?? "";
		if (!monochromePalette.has(value)) fail(`SVG is not monochrome: unreviewed color in ${path}`);
	}
}

/** Allows one reviewed OMCS accent while retaining the inert, effect-free chart boundary. */
export function assertBenchmarkChartSvg(source: string, path: string): void {
	if (
		/<(?:linearGradient|radialGradient|filter|style|script|foreignObject|image|use|a|iframe|object|embed|animate|set)\b/i.test(source)
		|| /<\?xml-stylesheet\b|<!DOCTYPE\b|<!\[CDATA\[|<!--/i.test(source)
		|| /\s(?:on[a-z0-9:_-]+|style|(?:xlink:)?href|filter|cursor|clip-path|mask)\s*=/i.test(source)
	) {
		fail(`SVG is outside the benchmark palette: decorative effect or style escape in ${path}`);
	}
	let index = 0;
	while (index < source.length) {
		const start = source.indexOf("<", index);
		if (start < 0) break;
		if (source.startsWith("<?", start)) {
			const end = source.indexOf("?>", start + 2);
			if (end < 0) fail(`SVG is outside the benchmark palette: invalid processing instruction in ${path}`);
			if (start !== 0 || source.slice(start, end + 2) !== '<?xml version="1.0" encoding="UTF-8"?>') {
				fail(`SVG is outside the benchmark palette: unreviewed processing instruction in ${path}`);
			}
			index = end + 2;
			continue;
		}
		if (source.startsWith("</", start)) {
			const end = source.indexOf(">", start + 2);
			if (end < 0) fail(`SVG is outside the benchmark palette: invalid closing element in ${path}`);
			index = end + 1;
			continue;
		}
		const end = readTagEnd(source, start + 1);
		const parsed = parseAttributes(source.slice(start + 1, end), path);
		if (!benchmarkElements.has(parsed.name)) fail(`SVG is outside the benchmark palette: unreviewed element in ${path}`);
		const allowedAttributes = benchmarkAttributes[parsed.name];
		if (!allowedAttributes || Object.keys(parsed.attributes).some((attribute) => !allowedAttributes.has(attribute))) {
			fail(`SVG is outside the benchmark palette: unreviewed attribute in ${path}`);
		}
		index = end + 1;
	}
	const colorAttributes = source.matchAll(/\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*=\s*(["'])(.*?)\1/gi);
	for (const match of colorAttributes) {
		const value = match[2]?.trim().toUpperCase() ?? "";
		if (!benchmarkPalette.has(value)) fail(`SVG is outside the benchmark palette: unreviewed color in ${path}`);
	}
}

/** Keeps terminal fixtures in one reviewed Ghostty-style palette with no executable or decorative escape hatches. */
export function assertTerminalSvg(source: string, path: string): void {
	if (
		/<(?:linearGradient|radialGradient|filter|style|script|foreignObject|image|use|a|iframe|object|embed)\b/i.test(source)
		|| /<\?xml-stylesheet\b|<!DOCTYPE\b|<!\[CDATA\[|<!--/i.test(source)
		|| /\s(?:on[a-z0-9:_-]+|style|(?:xlink:)?href)\s*=/i.test(source)
	) {
		fail(`SVG is outside the terminal palette: decorative or executable content in ${path}`);
	}
	let index = 0;
	while (index < source.length) {
		const start = source.indexOf("<", index);
		if (start < 0) break;
		if (source.startsWith("<?", start)) {
			const end = source.indexOf("?>", start + 2);
			if (end < 0) fail(`SVG is outside the terminal palette: invalid processing instruction in ${path}`);
			if (start !== 0 || source.slice(start, end + 2) !== '<?xml version="1.0" encoding="UTF-8"?>') {
				fail(`SVG is outside the terminal palette: unreviewed processing instruction in ${path}`);
			}
			index = end + 2;
			continue;
		}
		if (source.startsWith("</", start)) {
			const end = source.indexOf(">", start + 2);
			if (end < 0) fail(`SVG is outside the terminal palette: invalid closing element in ${path}`);
			index = end + 1;
			continue;
		}
		const end = readTagEnd(source, start + 1);
		const parsed = parseAttributes(source.slice(start + 1, end), path);
		if (!terminalElements.has(parsed.name)) fail(`SVG is outside the terminal palette: unreviewed element in ${path}`);
		const allowedAttributes = terminalAttributes[parsed.name];
		if (!allowedAttributes || Object.keys(parsed.attributes).some((attribute) => !allowedAttributes.has(attribute))) {
			fail(`SVG is outside the terminal palette: unreviewed attribute in ${path}`);
		}
		index = end + 1;
	}
	const colorAttributes = source.matchAll(/\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*=\s*(["'])(.*?)\1/gi);
	for (const match of colorAttributes) {
		const value = match[2]?.trim().toUpperCase() ?? "";
		if (!terminalPalette.has(value)) fail(`SVG is outside the terminal palette: unreviewed color in ${path}`);
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

function assertSafeReviewedText(name: string, fixture: TerminalReviewFixture): void {
	if (!/^[a-f0-9]{64}$/.test(fixture.sha256) || fixture.visibleText.length === 0) fail(`invalid terminal review manifest: ${name}`);
	if (unsafeContentPatterns.some((pattern) => fixture.visibleText.some((value) => pattern.test(value)))) fail(`unsafe reviewed terminal text: ${name}`);
}

async function assertReviewedTerminal(root: string, name: (typeof terminalNames)[number], fixture: TerminalReviewFixture): Promise<void> {
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
	for (const asset of ["omcs-pipeline.svg", ...chartNames.map((name) => `${name}.svg`), ...terminalNames]) {
		if (!readme.includes(`docs/assets/${asset}`)) fail(`README does not embed required asset: ${asset}`);
	}
}

export async function verifyPublicDocs(options: VerifyPublicDocsOptions = {}): Promise<PublicDocsReport> {
	const root = resolve(options.repositoryRoot ?? repositoryRoot);
	const terminalReviewManifest = options.terminalReviewManifest ?? REVIEWED_TERMINAL_FIXTURES;
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
		assertMonochromeSvg(svg, svgPath);
		if (titleFromMermaid(source, sourcePath) !== parseSvgDiagram(svg, svgPath).title) fail(`diagram titles do not match: ${diagram}`);
	}

	for (const chart of chartNames) {
		const path = join(root, "docs", "assets", `${chart}.svg`);
		const bytes = await readFile(path);
		assertAssetSize(path, bytes);
		const source = bytes.toString("utf8");
		if (chart === "omcs-benchmark-calibration") assertMonochromeSvg(source, path);
		else assertBenchmarkChartSvg(source, path);
		const { width, height } = parseSvgDiagram(source, path);
		assertDimensions(path, width, height);
	}

	for (const terminal of terminalNames) {
		const path = join(root, "docs", "assets", terminal);
		const bytes = await readFile(path);
		assertAssetSize(path, bytes);
		const source = bytes.toString("utf8");
		assertTerminalSvg(source, path);
		const { width, height } = parseSvgDiagram(source, path);
		assertDimensions(path, width, height);
		await assertReviewedTerminal(root, terminal, terminalReviewManifest[terminal]);
	}

	return { guides: guidePaths.length, diagrams: [...diagramNames], charts: [...chartNames], terminals: [...terminalNames] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const report = await verifyPublicDocs();
	process.stdout.write(`verified ${report.guides} guides, ${report.diagrams.length} diagrams, ${report.charts.length} charts, and ${report.terminals.length} terminal views\n`);
}
