# Oh My Codex Slim Implementation Plan

> **Historical plan notice (2026-08-24).** The implementation below records the originally approved Codex Router cutover plan. OpenCodex is now the supported external-model transport. Router installation/cutover tasks are no longer current instructions; their source and attribution remain for recoverable legacy rollback. See [`docs/opencodex.md`](../../opencodex.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally prove a lean, native Codex App/CLI orchestration suite with Sol Advisor routing, curated engineering tools, and first-class Codex Router integration.

**Architecture:** Start from the pinned MIT Oh My Codex source, retain its proven plugin/CLI/config foundations, and delete non-slim runtimes before adding a small native-agent policy and MCP tool server. Codex Router remains the credential-owning companion process; OMCS talks to it only through supported CLI JSON contracts.

**Tech Stack:** Node.js 22.19+, TypeScript 7, npm, Node test runner, Zod 4, Model Context Protocol TypeScript SDK, ast-grep CLI, Codex plugins/skills/hooks/custom-agent TOML.

**Spec:** `docs/superpowers/specs/2026-08-22-oh-my-codex-slim-design.md`

## Global Constraints

- Package name is `oh-my-codex-slim`; command is `omcs`; plugin identifier is `oh-my-codex-slim`.
- Node.js minimum is `22.19.0`; Bun is not a runtime requirement.
- Codex App and CLI are primary; tmux and terminal multiplexers are prohibited dependencies.
- No telemetry, analytics, automatic external downloads, or secret-bearing logs.
- Only `omcs-*` native-agent files and exact OMCS-owned config records may be changed or removed.
- External agents are selectable only when Codex Router reports them enabled and proven.
- Every mutation has dry-run output, an atomic write, and a timestamped backup.
- Upstream revisions and MIT notices in the spec are preserved in `THIRD_PARTY_NOTICES.md`.
- No real model request runs without explicit quota confirmation.

## Target file map

```text
package.json                              package identity and commands
src/cli/omcs.ts                           CLI entrypoint and command routing
src/cli/setup.ts                          scoped, ownership-aware installation
src/cli/doctor.ts                         read-only health aggregation
src/cli/uninstall.ts                      ownership-aware removal
src/config/managed-files.ts               ownership records and atomic writes
src/config/codex-home.ts                  CODEX_HOME path resolution
src/agents/catalog.ts                     native agent definitions
src/agents/install.ts                     TOML rendering/install/check
src/orchestration/risk.ts                 route and implementer classification
src/orchestration/packets.ts              five-part delegation packets
src/router/adapter.ts                     Router process execution and parsing
src/router/types.ts                       normalized Router capability types
src/router/migrate-opencodex.ts           reversible OpenCodex migration
src/mcp/server.ts                         MCP stdio entrypoint
src/mcp/ast.ts                            ast-grep tools
src/mcp/lsp.ts                            installed-language-server bridge
src/mcp/codemap.ts                        deterministic repository map
src/mcp/clonedeps.ts                      read-only dependency clones
plugins/oh-my-codex-slim/                 universal Codex plugin bundle
skills/                                   source skill catalog
prompts/                                  native agent prompts
test/fixtures/                            isolated Codex/Router/OpenCodex states
```

---

### Task 1: Establish the attributed fork baseline

**Files:**
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `.upstream-revisions.json`
- Preserve: `docs/superpowers/specs/2026-08-22-oh-my-codex-slim-design.md`
- Preserve: `docs/superpowers/plans/2026-08-22-oh-my-codex-slim-implementation.md`

**Interfaces:**
- Consumes: pinned upstream revisions from the spec.
- Produces: a Git repository containing the exact Oh My Codex baseline plus provenance records.

- [ ] **Step 1: Initialize and import the exact baseline**

Run from `$REPO_ROOT`:

```bash
git init -b main
git remote add upstream-omx https://github.com/Yeachan-Heo/oh-my-codex.git
git fetch --depth=1 upstream-omx 3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2
git checkout FETCH_HEAD -- .
```

Expected: upstream files are staged; both OMCS design documents remain present.

- [ ] **Step 2: Write the provenance lock**

Create `.upstream-revisions.json` with exactly:

```json
{
  "oh-my-codex": "3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2",
  "oh-my-opencode-slim": "4940f73515d2969c50536fa1ec30a9ef5ee86741",
  "mattpocock-skills": "5b15a47f2d7150f545fbcacbfe381787fc0230dc",
  "sol-advisor": "37b75cad535abdd46531f0227483a8842d045ab8",
  "codex-router": "866cb8b011fa8e16900c77c58249b71eec6436ca"
}
```

Create `THIRD_PARTY_NOTICES.md` with one section per source, its repository URL,
revision, MIT copyright notice, and a statement that Oh My OpenAgent is a
behavioral reference with no copied source.

- [ ] **Step 3: Verify attribution is complete**

Run:

```bash
node -e 'const p=require("./.upstream-revisions.json"); if(Object.keys(p).length!==5) process.exit(1)'
rg -n "Yeachan-Heo|alvinunreal|mattpocock|DannyMac180|duolahypercho" THIRD_PARTY_NOTICES.md
```

Expected: five revision entries and five attribution matches.

- [ ] **Step 4: Commit the baseline**

```bash
git add .
git commit -m "chore: import attributed oh-my-codex baseline"
```

---

### Task 2: Rename and prune to a slim Codex-native product

**Files:**
- Modify: `package.json`
- Modify: `src/cli/index.ts`
- Move: `src/cli/omx.ts` to `src/cli/omcs.ts`
- Remove: `crates/`, `geobench/`, `packages/vscode-extension/`, `src/adapt/`, `src/auth/`, `src/hud/`, `src/openclaw/`, `src/sidecar/`, `src/team/`, `src/vscode/`, terminal-multiplexer scripts and tests
- Test: `src/cli/__tests__/package-bin-contract.test.ts`
- Test: `src/cli/__tests__/slim-boundary.test.ts`

**Interfaces:**
- Consumes: upstream CLI and build infrastructure.
- Produces: `omcs` executable and a dependency graph with no tmux/OpenCode/OpenClaw paths.

- [ ] **Step 1: Write boundary tests before pruning**

Add assertions equivalent to:

```ts
test('package exposes only the omcs binary', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.deepEqual(pkg.bin, { omcs: 'dist/cli/omcs.js' });
  assert.equal(pkg.name, 'oh-my-codex-slim');
  assert.equal(pkg.engines.node, '>=22.19.0');
});

test('slim source excludes terminal and unrelated runtimes', () => {
  for (const path of ['src/team', 'src/hud', 'src/openclaw', 'src/vscode']) {
    assert.equal(existsSync(path), false, path);
  }
  const pkg = readFileSync('package.json', 'utf8');
  assert.doesNotMatch(pkg, /tmux|opencode|openclaw/i);
});
```

- [ ] **Step 2: Run the tests and confirm the baseline fails**

```bash
npm install
npm run build
node --test dist/cli/__tests__/package-bin-contract.test.js dist/cli/__tests__/slim-boundary.test.js
```

Expected: FAIL because the package is still `oh-my-codex` and excluded directories exist.

- [ ] **Step 3: Remove exact non-slim subsystems and rename the entrypoint**

Remove only the exact paths listed in this task. Update imports and package scripts so
`npm run build`, `npm test`, and `npm run lint` have no references to removed modules.
Set package identity to:

```json
{
  "name": "oh-my-codex-slim",
  "version": "0.1.0",
  "type": "module",
  "bin": { "omcs": "dist/cli/omcs.js" },
  "engines": { "node": ">=22.19.0" },
  "license": "MIT"
}
```

- [ ] **Step 4: Run build, boundary tests, and dependency scan**

```bash
npm run build
node --test dist/cli/__tests__/package-bin-contract.test.js dist/cli/__tests__/slim-boundary.test.js
rg -n -i "tmux|zellij|openclaw|@opencode" src package.json
```

Expected: tests PASS; the scan returns no runtime references.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: establish slim Codex-native runtime"
```

---

### Task 3: Build the universal Codex plugin and managed installer

**Files:**
- Create: `plugins/oh-my-codex-slim/.codex-plugin/plugin.json`
- Create: `plugins/oh-my-codex-slim/.mcp.json`
- Create: `plugins/oh-my-codex-slim/.app.json`
- Create: `plugins/oh-my-codex-slim/hooks/hooks.json`
- Create: `plugins/oh-my-codex-slim/hooks/omcs-hook.mjs`
- Create: `.agents/plugins/marketplace.json`
- Create: `src/config/managed-files.ts`
- Create: `src/config/codex-home.ts`
- Modify: `src/cli/setup.ts`
- Test: `src/cli/__tests__/setup-ownership.test.ts`
- Test: `src/cli/__tests__/plugin-contract.test.ts`

**Interfaces:**
- Produces: `writeManagedFile(path, bytes, manifest): Promise<void>`, `setup(options): Promise<SetupReport>`.
- `SetupReport` is `{ changed: string[]; unchanged: string[]; conflicts: string[]; backups: string[] }`.

- [ ] **Step 1: Write failing ownership and manifest tests**

```ts
test('setup refuses an unknown existing omcs agent', async () => {
  const home = await fixtureCodexHome({ 'agents/omcs-fixer.toml': 'user data' });
  const report = await setup({ codexHome: home, scope: 'user', dryRun: false });
  assert.deepEqual(report.conflicts, ['agents/omcs-fixer.toml']);
  assert.equal(await readFile(join(home, 'agents/omcs-fixer.toml'), 'utf8'), 'user data');
});

test('plugin manifest names only real companion files', () => {
  const manifest = readJson('plugins/oh-my-codex-slim/.codex-plugin/plugin.json');
  assert.equal(manifest.name, 'oh-my-codex-slim');
  assert.equal(existsSync('plugins/oh-my-codex-slim/.mcp.json'), true);
  assert.equal(existsSync('plugins/oh-my-codex-slim/.app.json'), true);
});
```

- [ ] **Step 2: Confirm both tests fail**

```bash
npm run build
node --test dist/cli/__tests__/setup-ownership.test.js dist/cli/__tests__/plugin-contract.test.js
```

- [ ] **Step 3: Implement exact ownership records and atomic writes**

Use this record shape in `${CODEX_HOME}/oh-my-codex-slim/managed-files.json`:

```ts
export interface ManagedFileRecord {
  path: string;
  sha256: string;
  installedAt: string;
  sourceVersion: string;
}
```

Write to a sibling temporary file, `fsync`, rename atomically, then record the
digest. Existing files are replaceable only when their digest matches the
previous OMCS record. Dry-run computes the same report without writing.

- [ ] **Step 4: Create and validate the plugin bundle**

The manifest must declare `skills`, `mcpServers`, `apps`, and Developer Tools
interface metadata. The marketplace entry must use local source
`./plugins/oh-my-codex-slim`, `AVAILABLE`, `ON_INSTALL`, and category
`Developer Tools`.

```bash
python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py" plugins/oh-my-codex-slim
npm run build
node --test dist/cli/__tests__/setup-ownership.test.js dist/cli/__tests__/plugin-contract.test.js
```

Expected: validator and tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins .agents src/config src/cli
git commit -m "feat: add native Codex plugin and safe setup"
```

---

### Task 4: Implement the native agent catalog and Sol routing policy

**Files:**
- Create: `src/agents/catalog.ts`
- Create: `src/agents/install.ts`
- Create: `src/orchestration/risk.ts`
- Create: `src/orchestration/packets.ts`
- Create: `prompts/*.md`
- Test: `src/agents/__tests__/catalog.test.ts`
- Test: `src/orchestration/__tests__/risk.test.ts`
- Test: `src/orchestration/__tests__/packets.test.ts`

**Interfaces:**
- Produces: `AGENT_CATALOG: readonly AgentDefinition[]`.
- Produces: `selectRoute(input: RiskInput): RouteDecision`.
- Produces: `buildDelegationPacket(input: PacketInput): string`.

- [ ] **Step 1: Define failing catalog and routing tests**

```ts
test('catalog pins the eight v1 roles', () => {
  assert.deepEqual(AGENT_CATALOG.map(a => [a.name, a.model, a.effort]), [
    ['omcs_architect', 'gpt-5.6-sol', 'high'],
    ['omcs_explorer', 'gpt-5.6-luna', 'low'],
    ['omcs_librarian', 'gpt-5.6-luna', 'medium'],
    ['omcs_oracle', 'gpt-5.6-sol', 'high'],
    ['omcs_fixer', 'gpt-5.6-luna', 'max'],
    ['omcs_terra_fixer', 'gpt-5.6-terra', 'high'],
    ['omcs_designer', 'gpt-5.6-terra', 'high'],
    ['omcs_reviewer', 'gpt-5.6-sol', 'high']
  ]);
});

test('high blast radius selects full with Terra', () => {
  assert.deepEqual(selectRoute({ settled: true, blastRadius: 'wide', reviewRequired: true }), {
    mode: 'full', implementer: 'omcs_terra_fixer', reviewer: 'omcs_reviewer'
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm run build
node --test dist/agents/__tests__/catalog.test.js dist/orchestration/__tests__/*.test.js
```

- [ ] **Step 3: Implement route types and deterministic rules**

```ts
export type RouteMode = 'solo' | 'delegate' | 'audit' | 'full' | 'council';
export type BlastRadius = 'narrow' | 'moderate' | 'wide';
export interface RiskInput {
  settled: boolean;
  blastRadius: BlastRadius;
  reviewRequired: boolean;
  visual?: boolean;
  councilRequested?: boolean;
}
export interface RouteDecision {
  mode: RouteMode;
  implementer?: string;
  reviewer?: 'omcs_reviewer';
}
```

Rules: council request returns read-only `council`; unsettled work returns
`solo`; visual implementation uses designer; wide blast radius uses Terra;
review-required direct work uses audit; reviewed delegated work uses full;
bounded settled work uses Luna delegate.

- [ ] **Step 4: Render and check exact TOML ownership**

The installer writes only `omcs-*.toml`; read-only roles set
`sandbox_mode = "read-only"`. Every TOML includes `name`, `description`,
`model`, `model_reasoning_effort`, and `developer_instructions`.

```bash
npm run build
node --test dist/agents/__tests__/catalog.test.js dist/orchestration/__tests__/*.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents src/orchestration prompts
git commit -m "feat: add Sol-guided native agent routing"
```

---

### Task 5: Curate and validate the twelve-skill catalog

**Files:**
- Create or adapt: `skills/*/SKILL.md`
- Create: `src/catalog/skills.ts`
- Create: `src/scripts/verify-skills.ts`
- Test: `src/catalog/__tests__/skills.test.ts`
- Create: `THIRD_PARTY_NOTICES.md` skill provenance entries

**Interfaces:**
- Produces: `SKILL_CATALOG` with exactly twelve unique names from the spec.
- Produces: `npm run verify:skills`.

- [ ] **Step 1: Write the catalog test**

```ts
test('v1 exposes exactly the approved lean skill set', () => {
  assert.deepEqual(SKILL_CATALOG.map(s => s.name).sort(), [
    'ai-slop-cleaner', 'codemap', 'code-review', 'deep-interview',
    'deepwork', 'diagnose', 'omcs-orchestrate', 'plan', 'research',
    'simplify', 'tdd', 'verification'
  ]);
});
```

- [ ] **Step 2: Confirm the catalog test fails**

```bash
npm run build
node --test dist/catalog/__tests__/skills.test.js
```

- [ ] **Step 3: Adapt skills with provenance and Codex-native tool names**

Copy only the selected upstream skill directories. Flatten them to
`skills/<name>/`, replace OpenCode-only tool names with Codex or OMCS MCP tool
names, and add this frontmatter contract to every skill:

```yaml
---
name: skill-name
description: One narrow trigger-focused sentence.
---
```

Each adapted skill receives a provenance line in `THIRD_PARTY_NOTICES.md` with
source repository, source path, revision, and whether it was modified.

- [ ] **Step 4: Validate every skill and duplicate trigger boundary**

```bash
npm run build
npm run verify:skills
for skill in skills/*; do python3 "$CODEX_HOME/skills/.system/skill-creator/scripts/quick_validate.py" "$skill"; done
node --test dist/catalog/__tests__/skills.test.js
```

Expected: twelve validated skills, no duplicate name, no OpenCode tool names.

- [ ] **Step 5: Commit**

```bash
git add skills src/catalog src/scripts THIRD_PARTY_NOTICES.md
git commit -m "feat: add lean attributed engineering skills"
```

---

### Task 6: Build the code-intelligence MCP server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/ast.ts`
- Create: `src/mcp/lsp.ts`
- Create: `src/mcp/codemap.ts`
- Create: `src/mcp/clonedeps.ts`
- Test: `src/mcp/__tests__/server.test.ts`
- Test: `src/mcp/__tests__/path-security.test.ts`

**Interfaces:**
- Produces the seven MCP tools named in the spec.
- All tool results are `{ ok: boolean; data?: unknown; error?: { code: string; message: string } }`.

- [ ] **Step 1: Write failing protocol and traversal tests**

```ts
test('server lists the exact v1 tool surface', async () => {
  const names = (await listTools()).map(t => t.name).sort();
  assert.deepEqual(names, [
    'omcs_ast_replace', 'omcs_ast_search', 'omcs_clone_dependency',
    'omcs_codemap', 'omcs_diagnostics', 'omcs_references', 'omcs_symbols'
  ]);
});

test('clone dependency rejects a destination outside the project', async () => {
  const result = await cloneDependency({ root, url: fixtureUrl, destination: '../escape' });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'path-outside-project');
});
```

- [ ] **Step 2: Confirm failure**

```bash
npm run build
node --test dist/mcp/__tests__/server.test.js dist/mcp/__tests__/path-security.test.js
```

- [ ] **Step 3: Implement deterministic tools**

Use `execFile`, never shell interpolation. Resolve every file against the
canonical project root. AST operations invoke the pinned ast-grep executable.
LSP operations detect only configured executables and return
`language-server-unavailable` without downloading anything. Clone destinations
are forced beneath `.omcs/clonedeps/repos/` and record URL plus immutable
revision in `.omcs/clonedeps/manifest.json`.

- [ ] **Step 4: Run protocol, traversal, and fixture tests**

```bash
npm run build
node --test dist/mcp/__tests__/*.test.js
```

Expected: PASS with no network required.

- [ ] **Step 5: Commit**

```bash
git add src/mcp package.json package-lock.json
git commit -m "feat: add secure code-intelligence MCP tools"
```

---

### Task 7: Add the typed Codex Router adapter

**Files:**
- Create: `src/router/types.ts`
- Create: `src/router/adapter.ts`
- Create: `src/router/commands.ts`
- Test: `src/router/__tests__/adapter.test.ts`
- Test fixtures: `test/fixtures/router/*.json`

**Interfaces:**
- Produces: `readRouterCapabilities(options): Promise<RouterCapabilities>`.
- Produces: `runRouterCommand(command, options): Promise<CommandResult>`.

- [ ] **Step 1: Write failing parser tests**

```ts
test('normalizes proven Router subagents', async () => {
  const result = await readRouterCapabilities({ runner: fixtureRunner('healthy-proven') });
  assert.deepEqual(result, {
    installed: true,
    healthy: true,
    version: '0.4.0-beta.4',
    subagentMode: 'proven',
    enabledAgents: ['router_kimi_k3'],
    disabledAgents: []
  });
});

test('malformed output is incompatible, never guessed', async () => {
  await assert.rejects(
    readRouterCapabilities({ runner: fixtureRunner('malformed') }),
    /incompatible-router/
  );
});
```

- [ ] **Step 2: Confirm failure**

```bash
npm run build
node --test dist/router/__tests__/adapter.test.js
```

- [ ] **Step 3: Implement supported command execution**

Use these exact command boundaries:

```ts
const ROUTER_COMMANDS = {
  version: ['codex-router', 'version'],
  status: ['codex-router', 'status', '--json'],
  doctor: ['codex-router', 'doctor', '--json'],
  subagents: ['codex-router', 'control', 'subagents', 'status']
} as const;
```

Parse JSON with Zod. Time out after 15 seconds. Redact stderr through a
credential-pattern scrubber before returning it. Do not read Router state or
secret files directly.

- [ ] **Step 4: Verify missing, unhealthy, v1-only, proven-v2, and malformed fixtures**

```bash
npm run build
node --test dist/router/__tests__/*.test.js
```

Expected: all five state classes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/router test/fixtures/router
git commit -m "feat: integrate Codex Router capability discovery"
```

---

### Task 8: Implement reversible OpenCodex migration

**Files:**
- Create: `src/router/migrate-opencodex.ts`
- Create: `src/router/migration-manifest.ts`
- Modify: `src/cli/omcs.ts`
- Test: `src/router/__tests__/migrate-opencodex.test.ts`
- Test fixtures: `test/fixtures/opencodex/`

**Interfaces:**
- Produces: `planOpenCodexMigration(options): Promise<MigrationPlan>`.
- Produces: `applyOpenCodexMigration(plan): Promise<MigrationResult>`.
- Produces: `rollbackOpenCodexMigration(manifestPath): Promise<MigrationResult>`.

- [ ] **Step 1: Write dry-run, redaction, and rollback tests**

```ts
test('dry-run reports changes without mutating config', async () => {
  const before = await readFile(configPath);
  const plan = await planOpenCodexMigration({ codexHome, openCodexHome, dryRun: true });
  assert.equal(plan.actions.some(a => a.kind === 'disable-opencodex'), true);
  assert.deepEqual(await readFile(configPath), before);
  assert.doesNotMatch(JSON.stringify(plan), /secret-value/);
});

test('rollback restores byte-identical Codex config', async () => {
  const before = await readFile(configPath);
  const result = await applyOpenCodexMigration(await planOpenCodexMigration(fixture));
  await rollbackOpenCodexMigration(result.manifestPath);
  assert.deepEqual(await readFile(configPath), before);
});
```

- [ ] **Step 2: Confirm failure**

```bash
npm run build
node --test dist/router/__tests__/migrate-opencodex.test.js
```

- [ ] **Step 3: Implement the explicit migration state machine**

```ts
export type MigrationPhase =
  | 'detected'
  | 'backed-up'
  | 'opencodex-disabled'
  | 'router-enabled'
  | 'verified'
  | 'rolled-back';
```

Store a manifest containing paths, digests, service states, and phase only.
Provider keys move through stdin to Router's supported credential command and
must never enter the manifest, argv, logs, or test snapshots. Unknown catalog
owners or modified backups stop before mutation.

- [ ] **Step 4: Verify all migration fixtures**

```bash
npm run build
node --test dist/router/__tests__/migrate-opencodex.test.js
```

Expected: clean migration, dry-run, unknown-owner refusal, interrupted-phase
recovery, redaction, and byte-identical rollback PASS.

- [ ] **Step 5: Commit**

```bash
git add src/router src/cli test/fixtures/opencodex
git commit -m "feat: add recoverable OpenCodex migration"
```

---

### Task 9: Complete status, doctor, update, uninstall, and release gates

**Files:**
- Modify: `src/cli/doctor.ts`
- Modify: `src/cli/uninstall.ts`
- Modify: `src/cli/omcs.ts`
- Create: `src/cli/status.ts`
- Create: `src/cli/update.ts`
- Create: `src/scripts/verify-release.ts`
- Test: `src/cli/__tests__/lifecycle.test.ts`
- Modify: `README.md`
- Create: `docs/installation.md`
- Create: `docs/architecture.md`
- Create: `docs/router.md`
- Create: `docs/troubleshooting.md`

**Interfaces:**
- `omcs doctor --json` returns `{ ok, checks, warnings, errors }`.
- `omcs status --json` returns product, plugin, agents, MCP, and Router state.
- `npm run verify:release` performs all non-billed release gates.

- [ ] **Step 1: Write lifecycle tests**

```ts
test('setup is idempotent and uninstall preserves unrelated files', async () => {
  await setup(fixture);
  const second = await setup(fixture);
  assert.deepEqual(second.changed, []);
  await writeFile(join(codexHome, 'agents/user-agent.toml'), 'keep');
  await uninstall(fixture);
  assert.equal(await readFile(join(codexHome, 'agents/user-agent.toml'), 'utf8'), 'keep');
});
```

- [ ] **Step 2: Confirm failure**

```bash
npm run build
node --test dist/cli/__tests__/lifecycle.test.js
```

- [ ] **Step 3: Implement lifecycle commands and machine-readable output**

Doctor checks Node, Codex, plugin manifest, marketplace, managed files, agent
TOMLs, MCP startup, Router compatibility, and stale OpenCodex routing. Update
uses the same ownership rules as setup. Uninstall removes only digest-matching
managed artifacts and leaves Router installed.

- [ ] **Step 4: Add complete user documentation**

Document install, App discovery, CLI discovery, router setup, dry-run migration,
rollback, external-subagent proof requirements, privacy, and exact uninstall.
README must state that primary model routing works more broadly than native
external subagents.

- [ ] **Step 5: Run the full non-billed release gate**

```bash
npm run lint
npm run build
npm test
npm run verify:skills
npm run verify:release
python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py" plugins/oh-my-codex-slim
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src README.md docs package.json package-lock.json
git commit -m "feat: complete OMCS lifecycle and release verification"
```

---

### Task 10: Install locally and prove Codex App/CLI parity

**Files:**
- Modify only through supported installer commands: personal or repo marketplace, `${CODEX_HOME}` managed files, and Codex Router integration.
- Evidence: `.omcs/evidence/local-install.json`

**Interfaces:**
- Consumes: release-verified package from Task 9.
- Produces: local App/CLI discovery evidence and an untouched rollback path.

- [ ] **Step 1: Capture read-only preflight state**

```bash
codex --version
codex plugin list --json
omcs setup --scope user --dry-run
omcs migrate opencodex --dry-run
```

Expected: no mutation and no credential values.

- [ ] **Step 2: Install from the project marketplace**

```bash
codex plugin marketplace add "$REPO_ROOT"
codex plugin add oh-my-codex-slim@oh-my-codex-slim
omcs setup --scope user
omcs agents check
omcs doctor --json
```

Expected: plugin, eight agents, MCP configuration, and management records are healthy.

- [ ] **Step 3: Install/enable Router and perform the approved migration**

Run the exact commands shown by `omcs router install` and
`omcs migrate opencodex --dry-run`, then:

```bash
omcs router doctor
omcs router capabilities
omcs migrate opencodex
omcs doctor --json
```

Expected: Codex no longer points at OpenCodex, Router is healthy, and the
OpenCodex data directory remains available for rollback.

- [ ] **Step 4: Prove CLI discovery without a billed model call**

Start a new Codex CLI session, run `/plugins`, and confirm the plugin, skills,
agents, and MCP tools appear. Save redacted discovery output to
`.omcs/evidence/local-install.json`.

- [ ] **Step 5: Prove desktop discovery in a new Codex task**

Restart Codex when prompted, create a new task, and verify the same plugin,
skills, agents, MCP tools, and Router model picker. Do not claim model execution
proof from discovery alone.

- [ ] **Step 6: Run one real smoke test only after explicit quota approval**

```bash
omcs smoke-test --model gpt-5.6-sol --expect OMCS-SMOKE-OK
```

Expected exact response: `OMCS-SMOKE-OK`.

- [ ] **Step 7: Final review and commit evidence**

Run a fresh read-only Sol review over the implementation diff and verification
evidence. A `fix-first` or `rethink` verdict requires correction, full
re-verification, and a new review.

```bash
git add .omcs/evidence/local-install.json
git commit -m "test: record local Codex App and CLI proof"
```

## Completion checklist

- [ ] All ten tasks have commits and passing task-local tests.
- [ ] Full release gate passes from a clean checkout.
- [ ] Plugin is discoverable in both Codex App and CLI.
- [ ] Router migration has a tested rollback manifest.
- [ ] External subagents are limited to Router-proven definitions.
- [ ] No telemetry, secret output, tmux dependency, or OpenCode runtime remains.
- [ ] Fresh Sol reviewer verdict is `ship`.
