import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILL_CATALOG } from "../skills.js";

const repositoryRoot = process.cwd();
const approvedNames = [
	"ai-slop-cleaner",
	"codebase-design",
	"codemap",
	"code-review",
	"context",
	"deep-interview",
	"deepwork",
	"diagnose",
	"implement",
	"omcs",
	"omcs-orchestrate",
	"plan",
	"research",
	"simplify",
	"tdd",
	"verification",
] as const;

const expectedProvenance: Record<string, readonly [string, string, string, string, string]> = {
	"ai-slop-cleaner": ["Yeachan-Heo/oh-my-codex", "skills/ai-slop-cleaner/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo", "Yeachan-Heo"],
	"codebase-design": ["mattpocock/skills", "skills/engineering/codebase-design/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	codemap: ["alvinunreal/oh-my-opencode-slim", "src/skills/codemap/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin", "alvinunreal"],
	"code-review": ["mattpocock/skills", "skills/engineering/code-review/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	context: ["mattpocock/skills", "skills/engineering/grill-with-docs/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	"deep-interview": ["Yeachan-Heo/oh-my-codex", "skills/deep-interview/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo", "Yeachan-Heo"],
	deepwork: ["alvinunreal/oh-my-opencode-slim", "src/skills/deepwork/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin", "alvinunreal"],
	diagnose: ["mattpocock/skills", "skills/engineering/diagnosing-bugs/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	implement: ["mattpocock/skills", "skills/engineering/implement/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	omcs: ["DannyMac180/sol-advisor", "plugins/sol-advisor/skills/orchestration/SKILL.md", "37b75cad535abdd46531f0227483a8842d045ab8", "Daniel McAteer", "DannyMac180"],
	"omcs-orchestrate": ["DannyMac180/sol-advisor", "plugins/sol-advisor/skills/orchestration/SKILL.md", "37b75cad535abdd46531f0227483a8842d045ab8", "Daniel McAteer", "DannyMac180"],
	plan: ["Yeachan-Heo/oh-my-codex", "skills/plan/SKILL.md", "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2", "Yeachan Heo", "Yeachan-Heo"],
	research: ["mattpocock/skills", "skills/engineering/research/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	simplify: ["alvinunreal/oh-my-opencode-slim", "src/skills/simplify/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin", "alvinunreal"],
	tdd: ["mattpocock/skills", "skills/engineering/tdd/SKILL.md", "6654f6b60cd9d5be8b54c6fafe44346dabeb3b76", "Matt Pocock", "mattpocock"],
	verification: ["alvinunreal/oh-my-opencode-slim", "src/skills/verification-planning/SKILL.md", "aafd687ac8af2ef5dd50de52c7ab817c030ea6c2", "Alvin", "alvinunreal"],
};

function skillDirectories(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function readSkill(root: string, name: string): string {
	return readFileSync(join(root, name, "SKILL.md"), "utf8");
}

describe("lean skill catalog", () => {
	it("v1 exposes exactly the approved lean skill set", () => {
		assert.deepEqual(SKILL_CATALOG.map((skill) => skill.name).sort(), [...approvedNames].sort());
		assert.equal(new Set(SKILL_CATALOG.map((skill) => skill.name)).size, approvedNames.length);
	});

	it("ships the same exact catalog at the source and plugin discovery locations", () => {
		const sourceRoot = join(repositoryRoot, "skills");
		const pluginRoot = join(repositoryRoot, "plugins", "oh-my-codex-slim", "skills");
		assert.deepEqual(skillDirectories(sourceRoot), [...approvedNames].sort());
		assert.deepEqual(skillDirectories(pluginRoot), [...approvedNames].sort());
		for (const name of approvedNames) {
			assert.equal(readSkill(pluginRoot, name), readSkill(sourceRoot, name), `${name} discovery copy drifted`);
		}
	});

	it("uses narrow valid frontmatter and excludes prohibited runtime vocabulary", () => {
		const descriptions = new Set<string>();
		for (const skill of SKILL_CATALOG) {
			assert.match(skill.description, /^[A-Z][^\n]{20,220}\.$/);
			assert.equal(descriptions.has(skill.description), false, `${skill.name} duplicates another trigger description`);
			descriptions.add(skill.description);

			const markdown = readSkill(join(repositoryRoot, "skills"), skill.name);
			assert.match(markdown, new RegExp(`^---\\nname: ${skill.name}\\ndescription: [^\\n]+\\n---\\n`));
			assert.doesNotMatch(markdown, /\bOpenCode\b|LazyCodex|tmux|zellij|Claude|Gemini|telemetry|analytics|automatic(?:ally)? download/i);
		}
	});

	it("makes OMCS the explicit orchestration entrypoint and preserves the legacy alias", () => {
		const omcs = SKILL_CATALOG.find((skill) => skill.name === "omcs");
		assert.ok(omcs);
		const canonical = readSkill(join(repositoryRoot, "skills"), "omcs");
		const alias = readSkill(join(repositoryRoot, "skills"), "omcs-orchestrate");
		assert.match(`${omcs.description}\n${canonical}`, /use OMCS to solve this issue/i);
		assert.match(alias, /compatibility alias/i);
		assert.match(alias, /`omcs`/i);
	});

	it("gives every composed skill entry, boundary, evidence, and a next gate", () => {
		for (const skill of SKILL_CATALOG) {
			const markdown = readSkill(join(repositoryRoot, "skills"), skill.name);
			assert.match(markdown, /## Entry conditions/i, `${skill.name} has no entry conditions`);
			assert.match(markdown, /## Scope limit/i, `${skill.name} has no scope limit`);
			assert.match(markdown, /## Exit evidence/i, `${skill.name} has no exit evidence`);
			assert.match(markdown, /## Next gate/i, `${skill.name} has no next gate`);
		}
	});

	it("reserves AI slop cleanup for explicit generated-code cleanup and routes generic simplification separately", () => {
		const aiCleanup = SKILL_CATALOG.find((skill) => skill.name === "ai-slop-cleaner");
		const simplify = SKILL_CATALOG.find((skill) => skill.name === "simplify");
		assert.ok(aiCleanup);
		assert.ok(simplify);
		assert.match(aiCleanup.description, /explicit/i);
		assert.match(aiCleanup.description, /AI-generated|slop|noisy-generated/i);
		assert.doesNotMatch(simplify.description, /\b(?:AI|slop|generated)\b/i);
		assert.match(simplify.description, /behavior must remain unchanged/i);
		const skill = readSkill(join(repositoryRoot, "skills"), "ai-slop-cleaner");
		assert.match(skill, /generic behavior-preserving simplification belongs to `simplify`/i);
		assert.match(skill, /automatically required before review/i);
		assert.match(skill, /changed-file scope/i);
	});

	it("ships linked worktree and clone-dependency references with exact supporting provenance", () => {
		const sourceRoot = join(repositoryRoot, "skills");
		const pluginRoot = join(repositoryRoot, "plugins", "oh-my-codex-slim", "skills");
		const resources = [
			["deepwork", "references/worktrees.md", "deepwork supporting resource: worktrees", "src/skills/worktrees/SKILL.md"],
			["codemap", "references/clone-dependency.md", "codemap supporting resource: clone-dependency", "src/skills/clonedeps/SKILL.md"],
		] as const;
		const notices = readFileSync(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
		for (const [skill, resource, heading, upstreamPath] of resources) {
			assert.ok(readSkill(sourceRoot, skill).includes(`(${resource})`), `${skill} does not link ${resource}`);
			assert.equal(readFileSync(join(sourceRoot, skill, resource), "utf8"), readFileSync(join(pluginRoot, skill, resource), "utf8"));
			const marker = `### ${heading}\n`;
			const start = notices.indexOf(marker);
			assert.notEqual(start, -1, `${heading} notice is missing`);
			const end = notices.indexOf("\n### ", start + marker.length);
			const lines = new Set(notices.slice(start, end === -1 ? undefined : end).split("\n"));
			assert.ok(lines.has("- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>"));
			assert.ok(lines.has(`- Source path: \`${upstreamPath}\``));
			assert.ok(lines.has("- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`"));
			assert.ok(lines.has("- License: MIT"));
			assert.ok(lines.has("- Status: modified adaptation"));
			assert.ok(lines.has("- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)"));
			assert.ok(lines.has("- Repository owner: `alvinunreal`"));
		}
	});

	it("records exact per-skill source paths, revisions, modification state, and author-owner identities", () => {
		const notices = readFileSync(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
		for (const skill of SKILL_CATALOG) {
			const marker = `### ${skill.name}`;
			const start = notices.indexOf(marker);
			assert.notEqual(start, -1, `${skill.name} provenance entry is missing`);
			const end = notices.indexOf("\n### ", start + marker.length);
			const entry = notices.slice(start, end === -1 ? undefined : end);
			assert.match(entry, /Source repository:/);
			assert.match(entry, /Source path:/);
			assert.match(entry, /Pinned revision: `[0-9a-f]{40}`/);
			assert.match(entry, /License: (?:MIT|Sustainable Use License)/);
			assert.match(entry, /Status: modified adaptation|Status: original synthesis|Status: compatibility alias/);
			assert.match(entry, /Upstream author\/copyright holder:/);
			assert.match(entry, /Repository owner:/);
			const [repository, sourcePath, revision, author, owner] = expectedProvenance[skill.name] ?? assert.fail(`missing provenance expectation for ${skill.name}`);
			assert.match(entry, new RegExp(`Source repository: <https://github\\.com/${repository.replace("/", "\\/")}>`));
			assert.ok(entry.includes(`Source path: \`${sourcePath}\``));
			assert.ok(entry.includes(`Pinned revision: \`${revision}\``));
			assert.ok(entry.includes(`Upstream author/copyright holder: ${author}`));
			assert.ok(entry.includes(`Repository owner: \`${owner}\``));
		}
	});
});
