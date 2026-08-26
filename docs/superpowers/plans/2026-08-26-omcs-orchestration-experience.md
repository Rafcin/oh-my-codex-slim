# OMCS Orchestration Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “use OMCS to solve this issue” activate a complete, safe, Codex-native orchestration pipeline with project/global/session configuration, deterministic profiles and routes, tuned skills, native agents, visible receipts, and public documentation.

**Architecture:** Add a small policy kernel under `src/orchestration/` and a safe configuration layer under `src/config/`. The CLI exposes configuration without becoming an orchestration daemon; the `omcs` skill remains the runtime entrypoint and delegates through Codex-native agents. OpenCodex remains the only optional external-model transport, and OMCS stores neither provider credentials nor private account preferences in the repository.

**Tech Stack:** TypeScript 7, Node.js 22, Zod 4, Node test runner, Biome, Markdown skill packages, Mermaid source diagrams, SVG/PNG documentation assets.

**Spec:** `docs/superpowers/specs/2026-08-26-omcs-orchestration-experience-design.md`

## Global Constraints

- Work test-first: add one focused failing test, observe the expected failure, implement the smallest behavior, rerun it, then commit.
- Preserve user-owned files. Configuration writes are bounded, atomic, symlink-safe, and refuse ambiguous overwrites.
- Keep OpenCodex as the only supported external-model transport. Do not add Codex Router, an OpenCode runtime, LazyCodex, telemetry, tmux, a daemon, or a credential store.
- Do not run a quota-consuming or billed real-model smoke test without separate explicit approval.
- Keep council advisory and explicit-only. Internal delivery routes are exactly `solo`, `delegate`, `audit`, and `full`.
- Keep exact upstream author, owner, path, revision, license, and modification status for every adapted skill or behavior.
- Commit after every completed task with its focused tests green.

---

### Task 1: Add the typed configuration model and precedence resolver

**Files:**

- Create: `schema/omcs.schema.json`
- Create: `src/config/omcs-config.ts`
- Create: `src/config/__tests__/omcs-config.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing parser and precedence tests**

Cover valid defaults, all four profiles, unknown-key rejection, wrong versions, values over the byte limit, project-over-global precedence, session-over-project precedence, absence of every file, symlink/hardlink refusal through `safeReadFile`, and discovery of the nearest Git root without leaving `cwd`'s filesystem root.

```ts
assert.deepEqual(parseOmcsConfig(Buffer.from('{"version":1,"profile":"fast"}'), "project"), {
  version: 1,
  profile: "fast",
});
assert.equal((await resolveOmcsConfig({ cwd, codexHome })).effective.profile, "thorough");
assert.deepEqual((await resolveOmcsConfig({ cwd, codexHome, session: { profile: "council" } })).sources, {
  defaults: true,
  global: globalPath,
  project: projectPath,
  session: true,
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run build && node --test dist/config/__tests__/omcs-config.test.js`

Expected: build fails because `src/config/omcs-config.ts` does not exist.

- [ ] **Step 3: Implement the schema and resolver**

Export these stable interfaces:

```ts
export type ExecutionProfile = "auto" | "fast" | "thorough" | "council";
export type ApprovalPolicy = "material" | "always" | "never";
export interface OmcsConfig {
  version: 1;
  profile?: ExecutionProfile;
  approvals?: ApprovalPolicy;
  antiSlop?: boolean;
  visibleProgress?: boolean;
}
export const DEFAULT_OMCS_CONFIG: Required<OmcsConfig>;
export function parseOmcsConfig(bytes: Uint8Array, label: string): OmcsConfig;
export function findProjectConfig(cwd: string): Promise<string | null>;
export function resolveOmcsConfig(input: ResolveOmcsConfigInput): Promise<ResolvedOmcsConfig>;
```

Use a strict Zod object, a 64 KiB read ceiling, `$CODEX_HOME/omcs/config.json` for global preferences, `<git-root>/omcs.config.json` for project policy, and an in-memory session overlay. Merge only known keys in this order: defaults, global, project, session. Never read or interpolate environment-variable values inside JSON.

- [ ] **Step 4: Add the published JSON Schema**

The schema must set `additionalProperties: false`, enumerate every profile and approval policy, require `version`, and contain descriptions that state credentials and model-account choices are not valid configuration fields.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run build && node --test dist/config/__tests__/omcs-config.test.js dist/config/__tests__/safe-reader.test.js`

Expected: all tests pass.

Commit: `feat: add OMCS configuration model`

---

### Task 2: Add ownership-safe configuration commands

**Files:**

- Create: `src/config/project-config.ts`
- Create: `src/config/__tests__/project-config.test.ts`
- Create: `src/cli/config.ts`
- Create: `src/cli/__tests__/config.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/__tests__/command-parsing.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing safe-write tests**

Test creation with mode `0644`, byte-for-byte dry-run behavior, refusal to overwrite an unowned different file, idempotent same-byte writes, `--update` replacement only after the current file parses as OMCS config, symlink and hardlink refusal, parent-directory symlink refusal, temporary-file cleanup, and exact rollback after injected rename failure.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm run build && node --test dist/config/__tests__/project-config.test.js`

Expected: missing module/build failure.

- [ ] **Step 3: Implement the bounded writer**

```ts
export interface WriteOmcsConfigOptions {
  path: string;
  config: OmcsConfig;
  update: boolean;
  dryRun: boolean;
}
export interface WriteOmcsConfigReport {
  action: "create" | "unchanged" | "update" | "would-create" | "would-update";
  path: string;
  bytes: number;
}
export function renderOmcsConfig(config: OmcsConfig): Buffer;
export function writeOmcsConfig(options: WriteOmcsConfigOptions): Promise<WriteOmcsConfigReport>;
```

Stage with `open(..., "wx", 0o644)`, sync the file, rename atomically, sync the directory, and restore exact prior bytes if commit fails. Do not write an ownership manifest into the project.

- [ ] **Step 4: Write failing CLI tests**

Cover:

```text
omcs configure --scope project --profile auto [--update] [--dry-run] [--json]
omcs configure --scope global --profile thorough [--update] [--dry-run] [--json]
omcs configure --scope session --profile fast --json
omcs config show --effective [--json]
omcs config validate [path] [--json]
```

Reject conflicting scopes, unknown profiles, positional arguments after `show`, writing session scope to disk, and unsupported flags.

- [ ] **Step 5: Implement CLI commands**

Export `configureOmcs`, `showEffectiveConfig`, and `validateOmcsConfigFile` from `src/cli/config.ts`. Human output must name the effective profile and source paths without printing configuration contents that are not part of the public schema. JSON output must be stable and machine-readable.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run build && node --test dist/config/__tests__/project-config.test.js dist/cli/__tests__/config.test.js dist/cli/__tests__/command-parsing.test.js`

Expected: all tests pass.

Commit: `feat: add safe OMCS configuration CLI`

---

### Task 3: Implement profiles, deterministic routes, skill gates, and route declarations

**Files:**

- Create: `src/orchestration/policy.ts`
- Create: `src/orchestration/declaration.ts`
- Create: `src/orchestration/__tests__/policy.test.ts`
- Create: `src/orchestration/__tests__/declaration.test.ts`
- Modify: `src/orchestration/risk.ts`
- Modify: `src/orchestration/__tests__/risk.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Replace council-route expectations with failing overlay tests**

Assert that `RouteMode` accepts only four delivery routes and that council returns an advisory overlay plus an ordinary implementation route.

```ts
assert.deepEqual(selectExecutionPolicy({ profile: "council", risk }), {
  profile: "council",
  route: { mode: "full", implementer: "omcs_terra_fixer", reviewer: "omcs_reviewer" },
  council: { enabled: true, explicit: true, implementer: null },
  skills: ["context", "codebase-design", "plan", "tdd", "ai-slop-cleaner", "verification", "code-review"],
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm run build && node --test dist/orchestration/__tests__/risk.test.js dist/orchestration/__tests__/policy.test.js`

Expected: the old council route and missing policy module fail.

- [ ] **Step 3: Implement the policy kernel**

Export:

```ts
export type RouteMode = "solo" | "delegate" | "audit" | "full";
export interface WorkSignals {
  settled: boolean;
  blastRadius: BlastRadius;
  reviewRequired: boolean;
  visual: boolean;
  delegable: boolean;
  needsResearch: boolean;
  hasReproduction: boolean;
  generatedCodeRisk: boolean;
}
export function selectExecutionPolicy(input: PolicyInput): ExecutionPolicy;
```

Make `fast` prefer `solo`/`delegate`, `thorough` require review and all relevant gates, `auto` follow signals, and `council` equal thorough plus an explicit read-only council. Anti-slop is an inspection gate; it may edit only changed-file scope and any edit invalidates earlier verification.

- [ ] **Step 4: Add a stable declaration renderer**

```ts
export function renderRouteDeclaration(policy: ExecutionPolicy): string;
```

The first line is always `OMCS <profile> · <route>`, followed by selected agents, selected skills, approval posture, and council state. It must never include credentials, environment values, absolute home paths, or prompt contents.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run build && node --test dist/orchestration/__tests__/risk.test.js dist/orchestration/__tests__/policy.test.js dist/orchestration/__tests__/declaration.test.js`

Expected: all tests pass.

Commit: `feat: add OMCS execution policy kernel`

---

### Task 4: Add redacted local run receipts

**Files:**

- Create: `src/orchestration/receipt.ts`
- Create: `src/orchestration/__tests__/receipt.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Write failing receipt tests**

Test deterministic serialization, `.omcs/runs/<UTC timestamp>-<random>.json` containment, `0600` file mode, atomic creation, symlink/hardlink/unknown-directory-entry refusal, bounded strings and arrays, and recursive rejection/redaction of keys matching `token`, `secret`, `password`, `credential`, `authorization`, `cookie`, `apiKey`, and provider-specific environment names.

- [ ] **Step 2: Confirm RED**

Run: `npm run build && node --test dist/orchestration/__tests__/receipt.test.js`

Expected: missing module/build failure.

- [ ] **Step 3: Implement receipts**

```ts
export interface OmcsRunReceipt {
  version: 1;
  startedAt: string;
  completedAt?: string;
  profile: ExecutionProfile;
  route: RouteMode;
  agents: AgentName[];
  skills: string[];
  decisions: string[];
  evidence: string[];
  outcome: "running" | "passed" | "failed" | "blocked";
}
export function writeRunReceipt(root: string, receipt: OmcsRunReceipt): Promise<string>;
```

Receipts contain metadata and evidence labels only—never raw tool output, prompts, diffs, model responses, provider configuration, or credentials. Add `/.omcs/` to `.gitignore`.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm run build && node --test dist/orchestration/__tests__/receipt.test.js`

Expected: all tests pass.

Commit: `feat: add private OMCS run receipts`

---

### Task 5: Strengthen native agent contracts and delegation packets

**Files:**

- Modify: `src/agents/catalog.ts`
- Modify: `src/agents/__tests__/catalog.test.ts`
- Modify: `src/agents/__tests__/definitions.test.ts`
- Modify: `src/orchestration/packets.ts`
- Modify: `src/orchestration/__tests__/packets.test.ts`
- Modify: `prompts/omcs-architect.md`
- Modify: `prompts/omcs-explorer.md`
- Modify: `prompts/omcs-librarian.md`
- Modify: `prompts/omcs-oracle.md`
- Modify: `prompts/omcs-fixer.md`
- Modify: `prompts/omcs-terra-fixer.md`
- Modify: `prompts/omcs-designer.md`
- Modify: `prompts/omcs-reviewer.md`

- [ ] **Step 1: Write failing contract tests**

Assert exactly eight roles, expected model/effort/permission, read-only roles never claiming implementation, implementers being told they are not alone in the codebase, reviewer freshness and verdict vocabulary, architect ownership of routing/acceptance, and designer ownership of visual review.

- [ ] **Step 2: Extend the delegation packet test**

Require these sections: Objective, Ownership, Interfaces, Context, Constraints, Verification, and Return Contract. Keep every section mandatory and reject empty or duplicate ownership paths.

- [ ] **Step 3: Confirm RED**

Run: `npm run build && node --test dist/agents/__tests__/catalog.test.js dist/agents/__tests__/definitions.test.js dist/orchestration/__tests__/packets.test.js`

Expected: packet and prompt contract assertions fail.

- [ ] **Step 4: Implement the contracts**

Keep role names and model assignments unchanged. Prompts must be concise role contracts rather than copies of upstream prompts. The reviewer uses `ship`, `fix-first`, or `rethink`, and any post-review edit invalidates its verdict.

- [ ] **Step 5: Run focused tests and commit**

Run: the command from Step 3.

Expected: all tests pass.

Commit: `feat: harden OMCS agent contracts`

---

### Task 6: Build the tuned skill catalog and OMCS entrypoint

**Required workflow:** Read and apply `superpowers:writing-skills` and `skill-creator` before editing skill packages.

**Files:**

- Create: `skills/omcs/SKILL.md`
- Create: `skills/context/SKILL.md`
- Create: `skills/codebase-design/SKILL.md`
- Create: `skills/implement/SKILL.md`
- Modify: `skills/omcs-orchestrate/SKILL.md`
- Modify: `skills/ai-slop-cleaner/SKILL.md`
- Modify: `skills/code-review/SKILL.md`
- Modify: `skills/plan/SKILL.md`
- Modify: `skills/tdd/SKILL.md`
- Modify: `skills/verification/SKILL.md`
- Modify: `src/catalog/skills.json`
- Modify: `src/catalog/__tests__/skills.test.ts`
- Modify: `src/catalog/__tests__/skill-sync.test.ts`
- Modify: `src/scripts/verify-skills.ts`
- Modify: `.upstream-revisions.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Create: `docs/upstream-sources.md`
- Regenerate: `plugins/oh-my-codex-slim/skills/**`

- [ ] **Step 1: Write failing catalog and trigger tests**

The catalog must expose exactly sixteen lean skills: the existing twelve plus `omcs`, `context`, `codebase-design`, and `implement`. Test that “use OMCS to solve this issue” is present in the `omcs` trigger description/body; `omcs-orchestrate` is a compatibility alias; each skill declares entry conditions, exit evidence, scope limits, and the next pipeline gate; anti-slop is automatic but edits only changed-file scope.

- [ ] **Step 2: Confirm RED**

Run: `npm run build && node --test dist/catalog/__tests__/skills.test.js dist/catalog/__tests__/skill-sync.test.js`

Expected: approved catalog mismatch and missing skill directories.

- [ ] **Step 3: Write the skills from the approved synthesis**

Use original concise language. Adapt concepts only from the pinned sources:

- Daniel McAteer / `DannyMac180/sol-advisor` at `37b75cad535abdd46531f0227483a8842d045ab8` for risk-gated routing and reviewer contracts.
- Matt Pocock / `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` for context grilling, domain/codebase design, implementation, TDD, review, and architecture inspection.
- Alvin / `alvinunreal/oh-my-opencode-slim` at `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2` for lean orchestration, deepwork, worktrees, and verification-planning concepts.
- `code-yeongyu/oh-my-openagent` at `b48ab1086b338921ccd99a11183f91eefbb169f2` as a behavioral reference only; do not copy source or prompts under its Sustainable Use License.

- [ ] **Step 4: Update exact provenance enforcement**

Every skill notice must include source repository, exact source path(s), pinned revision, license, modification status, upstream author/copyright holder, and repository owner. Update verification expectations to compare exact fields, not substring-only attribution.

- [ ] **Step 5: Synchronize discovery copies**

Run: `npm run sync:skills`

Expected: canonical skills atomically synchronize to the plugin tree and `.omcs-sync-manifest.json` updates; no unknown target is overwritten.

- [ ] **Step 6: Run skill verification and commit**

Run: `npm run verify:skills && npm run build && node --test dist/catalog/__tests__/skills.test.js dist/catalog/__tests__/skill-sync.test.js`

Expected: all checks pass and prohibited runtime vocabulary is absent from shipped skill content except the explicit OpenCodex transport documentation boundary.

Commit: `feat: ship the OMCS orchestration skill system`

---

### Task 7: Make the plugin activate cleanly in Codex App and CLI

**Files:**

- Modify: `plugins/oh-my-codex-slim/.codex-plugin/plugin.json`
- Modify: `plugins/oh-my-codex-slim/.codex-plugin/.app.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `src/scripts/validate-plugin.ts`
- Modify: `src/scripts/__tests__/validate-plugin.test.ts`
- Modify: `src/cli/__tests__/plugin-registration.test.ts`
- Modify: `src/cli/__tests__/release-contract.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing discovery-contract tests**

Assert the manifest describes an orchestration system, recommends `omcs` as the default entry skill, lists profiles and eight agents, keeps hooks inert, declares no apps or external MCP transport, and contains no credential/provider settings.

- [ ] **Step 2: Confirm RED**

Run: `npm run build && node --test dist/scripts/__tests__/validate-plugin.test.js dist/cli/__tests__/plugin-registration.test.js dist/cli/__tests__/release-contract.test.js`

Expected: current “future skill catalog” metadata fails.

- [ ] **Step 3: Update plugin and package contracts**

Make the default prompt explain that `omcs` orchestrates substantive engineering requests. Include new runtime/config/schema modules in the npm allowlist. Keep `.app.json` empty and hooks inert.

- [ ] **Step 4: Run focused tests and commit**

Run: the command from Step 2 plus `node --experimental-strip-types src/scripts/validate-plugin.ts plugins/oh-my-codex-slim`.

Expected: all checks pass.

Commit: `feat: activate OMCS in Codex discovery`

---

### Task 8: Build public documentation, diagrams, and sanitized screenshots

**Files:**

- Modify: `README.md`
- Modify: `docs/installation.md`
- Modify: `docs/architecture.md`
- Modify: `docs/opencodex.md`
- Modify: `docs/troubleshooting.md`
- Create: `docs/execution-modes.md`
- Create: `docs/agents-and-skills.md`
- Create: `docs/configuration.md`
- Create: `docs/examples.md`
- Create: `docs/diagrams/omcs-pipeline.mmd`
- Create: `docs/diagrams/omcs-routing.mmd`
- Create: `docs/diagrams/omcs-config-precedence.mmd`
- Create: `docs/assets/omcs-pipeline.svg`
- Create: `docs/assets/omcs-routing.svg`
- Create: `docs/assets/omcs-config-precedence.svg`
- Create: `docs/assets/omcs-configure-project.png`
- Create: `docs/assets/omcs-route-declaration.png`
- Create: `docs/assets/omcs-verification-receipt.png`
- Create: `src/scripts/verify-doc-assets.ts`
- Create: `src/scripts/__tests__/verify-doc-assets.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing documentation-contract tests**

Verify that README links every guide, embeds the three screenshots and primary pipeline diagram, explains profiles/routes/agents/skills/approvals, shows project/global/session setup, names OpenCodex as optional and sole external-model transport, names authors in the credits, and never tells users to install an OpenCode runtime, Router, LazyCodex, tmux, or telemetry.

- [ ] **Step 2: Add asset-safety tests**

Require valid PNG magic bytes, parseable SVG XML, matching `.mmd` source titles, bounded dimensions/file sizes, and a repository-wide scan of docs/assets and sample output for home paths, usernames, tokens, authorization headers, provider keys, private hostnames, and real thread/account identifiers.

- [ ] **Step 3: Confirm RED**

Run: `npm run build && node --test dist/scripts/__tests__/verify-doc-assets.test.js`

Expected: missing docs/assets and verifier failures.

- [ ] **Step 4: Write the guides and diagrams**

Document the exact lifecycle:

```text
intent → config/route → context/grill → explore/research → design/material decision
→ plan → TDD implementation → anti-slop/simplify → verification
→ risk-gated review → acceptance
```

Explain `auto`, `fast`, `thorough`, `council`; `solo`, `delegate`, `audit`, `full`; all eight agents; adaptive skill gates; route declarations; receipts; project/global/session scopes; update/uninstall; and non-billed verification boundaries.

- [ ] **Step 5: Generate sanitized screenshots from fixtures**

Use only synthetic paths such as `/Users/example/acme-widget`, synthetic commit IDs, and placeholder evidence. Render deterministic terminal fixtures to SVG, convert them to PNG with the local macOS `sips` utility, and retain only the PNG outputs. Do not capture a live terminal, desktop, account name, credential, or provider panel.

- [ ] **Step 6: Run docs verification and commit**

Run: `npm run build && node --test dist/scripts/__tests__/verify-doc-assets.test.js && node dist/scripts/verify-doc-assets.js`

Expected: all docs and asset gates pass.

Commit: `docs: publish the OMCS orchestration guide`

---

### Task 9: Expand offline release verification and public-secret scanning

**Files:**

- Modify: `src/scripts/verify-release.ts`
- Modify: `src/scripts/__tests__/release-isolation.test.ts`
- Modify: `src/cli/__tests__/slim-boundary.test.ts`
- Create: `src/scripts/public-secret-scan.ts`
- Create: `src/scripts/__tests__/public-secret-scan.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing release-gate tests**

Require every new runtime module, schema, guide, diagram, and screenshot in `npm pack --dry-run`; reject tests, receipts, planning docs, temp render sources, OpenCode runtimes, Router code, credential files, `.env*`, private keys, home paths, and unapproved binaries.

- [ ] **Step 2: Write failing secret-scanner fixtures**

Test positive detection for PEM keys, GitHub/OpenAI/provider token shapes, authorization headers, cookie values, private SSH material, local usernames/home paths, and accidental `.env` files. Test negative fixtures for documented variable names, redacted examples, checksums, public commit hashes, and synthetic placeholders.

- [ ] **Step 3: Confirm RED**

Run: `npm run build && node --test dist/scripts/__tests__/public-secret-scan.test.js dist/scripts/__tests__/release-isolation.test.js dist/cli/__tests__/slim-boundary.test.js`

Expected: missing scanner and release allowlist failures.

- [ ] **Step 4: Implement the read-only scanner and gate**

The scanner walks tracked files from `git ls-files -z`, refuses symlinks, skips approved binary parsing after checking filename and printable strings, reports only path/rule—not matched secret text—and returns nonzero on a finding.

- [ ] **Step 5: Run the complete offline gate and commit**

Run:

```bash
npm run build
npm run lint
npm run test
npm run verify:skills
npm run verify:docs
npm run verify:secrets
npm run verify:release
git diff --check
```

Expected: every command passes; `verify:release` explicitly says that fresh App/CLI discovery and any billed smoke remain separate.

Commit: `test: harden the OMCS public release gate`

---

### Task 10: Fresh local acceptance, independent review, and publication

**Required workflow:** Apply `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`.

**Files:**

- Modify only if review finds a proven defect; any fix requires focused regression test, re-verification, and a new reviewer verdict.

- [ ] **Step 1: Install into isolated App/CLI homes**

Create temporary `HOME`, `CODEX_HOME`, npm cache, and project Git repository. Pack the local npm artifact, install it into the isolated prefix, register the local plugin, and run:

```bash
omcs --help
omcs configure --scope project --profile auto --json
omcs config validate --json
omcs config show --effective --json
omcs setup --dry-run --json
omcs doctor --json
omcs status --json
```

Expected: CLI discovery succeeds, config is created only inside the fixture, plugin and eight agents are discoverable, and no network/provider/model call occurs.

- [ ] **Step 2: Verify ownership and rollback behavior in the isolated fixture**

Modify an OMCS-created project config, prove `configure` refuses to overwrite without `--update`, prove update succeeds only for valid OMCS config, run uninstall for managed lifecycle files, and verify the project policy and all user-owned files remain intact.

- [ ] **Step 3: Request fresh read-only code review**

Give the reviewer the committed spec, this plan, full diff, test evidence, npm pack manifest, and public-secret-scan result. Require `ship`, `fix-first`, or `rethink` with file/line evidence.

- [ ] **Step 4: Run a fresh security review**

Inspect configuration parsing/writes, path containment, receipts, CLI outputs, plugin packaging, screenshots, attribution, and tracked-file secret scanning. Do not expose any matched value in the report.

- [ ] **Step 5: Re-run all offline gates after the final review commit**

Run the complete command block from Task 9 Step 5 plus:

```bash
git status --short --branch
git log --oneline --decorate -12
git ls-files -z | xargs -0 -n1 printf '%s\n' | sort
```

Expected: clean worktree, focused commit history, only intended public files, all gates passing.

- [ ] **Step 6: Push the verified branch**

Run: `git push origin main`

Expected: `main` updates successfully. Do not push `private/pre-public-history-20260824` or any rollback/private branch.

- [ ] **Step 7: Report exact evidence boundaries**

Report source/tests, isolated App/CLI acceptance, security/review verdict, pushed commit, and explicitly state that no billed real-model smoke test was run. Ask for separate approval only if the user wants that specific billed smoke later.
