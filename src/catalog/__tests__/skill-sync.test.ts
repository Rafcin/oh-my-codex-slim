import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { SKILL_CATALOG } from "../skills.js";
import { syncDiscoveryCopies, verifySkills, type SkillSyncDependencies } from "../../scripts/verify-skills.js";

const fixtures: string[] = [];
const supportingNotices = [
	{
		heading: "codemap supporting resource: clone-dependency",
		path: "src/skills/clonedeps/SKILL.md",
	},
	{
		heading: "deepwork supporting resource: worktrees",
		path: "src/skills/worktrees/SKILL.md",
	},
] as const;

function supportingNotice(spec: (typeof supportingNotices)[number]): string {
	return [
		`### ${spec.heading}`,
		"- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>",
		`- Source path: \`${spec.path}\``,
		"- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`",
		"- License: MIT",
		"- Status: modified adaptation",
		"- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)",
		"- Repository owner: `alvinunreal`",
	].join("\n");
}

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await rm(fixture, { recursive: true, force: true });
});

async function fixtureRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "omcs-skill-sync-"));
	fixtures.push(root);
	for (const skill of SKILL_CATALOG) {
		const source = join(root, "skills", skill.name);
		const plugin = join(root, "plugins", "oh-my-codex-slim", "skills", skill.name);
		await mkdir(source, { recursive: true });
		await mkdir(plugin, { recursive: true });
		const bytes = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n`;
		await writeFile(join(source, "SKILL.md"), bytes);
		await writeFile(join(plugin, "SKILL.md"), bytes);
	}
	const notices = await readFile(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");
	await writeFile(join(root, "THIRD_PARTY_NOTICES.md"), notices);
	return root;
}

async function stageFile(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function snapshot(root: string): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	const walk = async (directory: string, relative = ""): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const childRelative = join(relative, entry.name);
			const child = join(directory, entry.name);
			if (entry.isDirectory()) await walk(child, childRelative);
			else result.set(childRelative, (await readFile(child)).toString("hex"));
		}
	};
	await walk(root);
	return result;
}

describe("skill discovery synchronization", () => {
	it("rejects symlinked plugin roots, skill directories, target files, and resource directories", async () => {
		for (const targetKind of ["root", "skill", "file", "resource", "resource-file", "canonical-resource"] as const) {
			const root = await fixtureRepository();
			const external = await mkdtemp(join(tmpdir(), "omcs-skill-external-"));
			fixtures.push(external);
			await writeFile(join(external, "sentinel"), "outside");
			const pluginRoot = join(root, "plugins", "oh-my-codex-slim", "skills");
			if (targetKind === "root") {
				await rm(pluginRoot, { recursive: true });
				await symlink(external, pluginRoot);
			} else if (targetKind === "skill") {
				await rm(join(pluginRoot, "plan"), { recursive: true });
				await symlink(external, join(pluginRoot, "plan"));
			} else if (targetKind === "file") {
				await rm(join(pluginRoot, "plan", "SKILL.md"));
				await symlink(join(external, "sentinel"), join(pluginRoot, "plan", "SKILL.md"));
			} else if (targetKind === "resource") {
				await mkdir(join(root, "skills", "plan", "references"));
				await writeFile(join(root, "skills", "plan", "references", "safe.md"), "safe");
				await symlink(external, join(pluginRoot, "plan", "references"));
			} else if (targetKind === "resource-file") {
				await mkdir(join(root, "skills", "plan", "references"));
				await writeFile(join(root, "skills", "plan", "references", "safe.md"), "safe");
				await mkdir(join(pluginRoot, "plan", "references"));
				await symlink(join(external, "sentinel"), join(pluginRoot, "plan", "references", "safe.md"));
			} else {
				await mkdir(join(root, "skills", "plan", "references"));
				await symlink(join(external, "sentinel"), join(root, "skills", "plan", "references", "safe.md"));
			}
			await assert.rejects(syncDiscoveryCopies({ repositoryRoot: root }), /unsafe|symbolic|outside/i);
			assert.equal(await readFile(join(external, "sentinel"), "utf8"), "outside");
		}
	});

	it("rolls back exact bytes, absence, and created directories after a partial staging failure", async () => {
		const root = await fixtureRepository();
		await syncDiscoveryCopies({ repositoryRoot: root });
		const target = join(root, "plugins", "oh-my-codex-slim", "skills", "plan", "SKILL.md");
		const before = await readFile(target);
		await writeFile(join(root, "skills", "plan", "SKILL.md"), `${before.toString("utf8")}changed\n`);
		await mkdir(join(root, "skills", "plan", "references"));
		await writeFile(join(root, "skills", "plan", "references", "new.md"), "new resource");
		let calls = 0;
		const dependencies: SkillSyncDependencies = {
			stageFile: async (path, bytes) => {
				calls += 1;
				if (calls === 2) {
					await writeFile(path, bytes.subarray(0, 3));
					throw new Error("injected partial stage failure");
				}
				await stageFile(path, bytes);
			},
		};
		await assert.rejects(syncDiscoveryCopies({ repositoryRoot: root }, dependencies), /partial stage failure/);
		assert.deepEqual(await readFile(target), before);
		await assert.rejects(readFile(join(root, "plugins", "oh-my-codex-slim", "skills", "plan", "references", "new.md")), /ENOENT/);
		await assert.rejects(readdir(join(root, "plugins", "oh-my-codex-slim", "skills", "plan", "references")), /ENOENT/);
		assert.equal((await readdir(join(root, "plugins", "oh-my-codex-slim", "skills", "plan"))).some((name) => name.includes(".omcs-tmp-")), false);
	});

	it("refuses unknown modified targets and unapproved plugin resources without overwriting them", async () => {
		const root = await fixtureRepository();
		await syncDiscoveryCopies({ repositoryRoot: root });
		const pluginPlan = join(root, "plugins", "oh-my-codex-slim", "skills", "plan", "SKILL.md");
		await writeFile(pluginPlan, "user-owned change");
		await writeFile(join(root, "skills", "plan", "SKILL.md"), "desired change");
		await assert.rejects(syncDiscoveryCopies({ repositoryRoot: root }), /unknown plugin skill content/);
		assert.equal(await readFile(pluginPlan, "utf8"), "user-owned change");

		await writeFile(join(root, "plugins", "oh-my-codex-slim", "skills", "research", "unknown.md"), "keep");
		await assert.rejects(syncDiscoveryCopies({ repositoryRoot: root }), /unknown plugin skill file/);
		assert.equal(await readFile(join(root, "plugins", "oh-my-codex-slim", "skills", "research", "unknown.md"), "utf8"), "keep");
	});

	it("restores every prior target and manifest when the manifest rename fails after target commits", async () => {
		const root = await fixtureRepository();
		await syncDiscoveryCopies({ repositoryRoot: root });
		const pluginRoot = join(root, "plugins", "oh-my-codex-slim", "skills");
		const before = await snapshot(pluginRoot);
		await writeFile(join(root, "skills", "plan", "SKILL.md"), "changed plan");
		await writeFile(join(root, "skills", "research", "SKILL.md"), "changed research");
		let calls = 0;
		const dependencies: SkillSyncDependencies = {
			rename: async (from, to) => {
				calls += 1;
				if (calls === 3) throw new Error("injected rename failure");
				await rename(from, to);
			},
		};
		await assert.rejects(syncDiscoveryCopies({ repositoryRoot: root }, dependencies), /rename failure/);
		assert.deepEqual(await snapshot(pluginRoot), before);
	});

	it("verification is read-only across canonical, discovery, notice, and build output state", async () => {
		const root = await fixtureRepository();
		await syncDiscoveryCopies({ repositoryRoot: root });
		await mkdir(join(root, "dist"));
		await writeFile(join(root, "dist", "sentinel"), "keep build output");
		const before = await snapshot(root);
		await verifySkills({ repositoryRoot: root });
		assert.deepEqual(await snapshot(root), before);
		const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
		assert.match(pkg.scripts["verify:skills"] ?? "", /tsc --noEmit/);
		assert.match(pkg.scripts["verify:skills"] ?? "", /src\/scripts\/verify-skills\.ts/);
		assert.doesNotMatch(pkg.scripts["verify:skills"] ?? "", /npm run build|rmSync|--sync/);

		const protectedRoots = [
			join(process.cwd(), "dist"),
			join(process.cwd(), "skills"),
			join(process.cwd(), "plugins", "oh-my-codex-slim", "skills"),
		];
		const repositoryBefore = await Promise.all(protectedRoots.map((path) => snapshot(path)));
		const command = spawnSync("npm", ["run", "verify:skills"], { cwd: process.cwd(), encoding: "utf8" });
		assert.equal(command.status, 0, command.stderr || command.stdout);
		assert.deepEqual(await Promise.all(protectedRoots.map((path) => snapshot(path))), repositoryBefore);
	});

	it("rejects each independently corrupted field in each supporting-resource notice section", async () => {
		const corruptions = [
			["repository", "- Source repository: <https://github.com/alvinunreal/oh-my-opencode-slim>", "- Source repository: <https://github.com/example/wrong>"],
			["source path", "PATH_PLACEHOLDER", "- Source path: `wrong/SKILL.md`"],
			["revision", "- Pinned revision: `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`", "- Pinned revision: `ffffffffffffffffffffffffffffffffffffffff`"],
			["license", "- License: MIT", "- License: Wrong"],
			["status", "- Status: modified adaptation", "- Status: unmodified"],
			["author", "- Upstream author/copyright holder: Alvin (owner/contributor metadata; the pinned MIT notice names no individual holder)", "- Upstream author/copyright holder: Wrong"],
			["owner", "- Repository owner: `alvinunreal`", "- Repository owner: `wrong`"],
		] as const;
		for (const spec of supportingNotices) {
			for (const [field, placeholder, replacement] of corruptions) {
				const root = await fixtureRepository();
				await syncDiscoveryCopies({ repositoryRoot: root });
				const noticePath = join(root, "THIRD_PARTY_NOTICES.md");
				const notices = await readFile(noticePath, "utf8");
				const original = placeholder === "PATH_PLACEHOLDER" ? `- Source path: \`${spec.path}\`` : placeholder;
				const marker = `### ${spec.heading}`;
				const sectionStart = notices.indexOf(marker);
				const sectionEnd = notices.indexOf("\n### ", sectionStart + marker.length);
				const section = notices.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
				assert.ok(section.includes(original), `${spec.heading} fixture lacks ${field}`);
				const corrupted = `${notices.slice(0, sectionStart)}${section.replace(original, replacement)}${sectionEnd === -1 ? "" : notices.slice(sectionEnd)}`;
				await writeFile(noticePath, corrupted);
				await assert.rejects(
					verifySkills({ repositoryRoot: root }),
					new RegExp(`${spec.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*${field}`, "i"),
				);
			}
		}
	});
});
