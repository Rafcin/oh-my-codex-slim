# OMCS Thin-Kernel Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` and `superpowers:test-driven-development` to
> implement this plan task-by-task. Use
> `superpowers:verification-before-completion` before completion. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OMCS's ceremony-heavy automatic routing with a tested
solo-first kernel that spends auxiliary agents, skills, verification, and fresh
review only when their evidence value justifies their cost.

**Architecture:** Keep the existing four delivery routes and explicit council
overlay, but classify consequence separately from uncertainty, default `auto`
and `fast` to primary-context ownership, require concrete delegation value,
preflight only a selected auxiliary, expose a binding execution budget, and
make focused skills finding-triggered. Preserve fail-closed independent review,
OpenCodex ownership, receipts, and exact upstream attribution.

**Tech Stack:** TypeScript 7, Node.js 22, Zod 4, Node test runner, Biome,
Markdown skill packages, Mermaid/SVG documentation assets.

**Spec:**
`docs/superpowers/specs/2026-08-27-omcs-thin-kernel-design.md`

## Global constraints

- Follow RED-GREEN-REFACTOR for every runtime or prompt-contract change.
- Do not change benchmark fixtures, graders, reference solutions, expected
  outputs, published CSV observations, or frozen-result mathematics.
- Do not execute a billed model run.
- Preserve OpenCodex as the supported external-model transport and never inspect
  or expose provider credentials.
- Keep Oh My OpenAgent behavioral-only; copy no code or prompt text.
- Preserve user changes and make focused commits after green gates.

---

### Task 1: Record the approved benchmark-driven design

**Files:**

- Create: `docs/superpowers/specs/2026-08-27-omcs-thin-kernel-design.md`
- Create: `docs/superpowers/plans/2026-08-27-omcs-thin-kernel-implementation.md`

- [ ] **Step 1: Write the approved design**

Record the measured failure mode, solo-first routing, separate consequence and
uncertainty, one-auxiliary budget, capability fallback, progressive skills,
binding stop condition, attribution boundary, and frozen benchmark discipline.

- [ ] **Step 2: Check formatting and scope**

Run:

```bash
git diff --check
rg -n "Matt Pocock|Daniel McAteer|Alvin|YeonGyu-Kim|Yeachan Heo" \
  docs/superpowers/specs/2026-08-27-omcs-thin-kernel-design.md
```

Expected: no whitespace errors and all consulted upstream author/owner names
are present.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-omcs-thin-kernel-design.md \
  docs/superpowers/plans/2026-08-27-omcs-thin-kernel-implementation.md
git commit -m "docs: approve OMCS thin routing kernel"
```

---

### Task 2: Drive the routing model with failing tests

**Files:**

- Modify: `src/orchestration/__tests__/risk.test.ts`
- Modify: `src/orchestration/__tests__/policy.test.ts`
- Modify: `src/orchestration/__tests__/declaration.test.ts`
- Modify: `src/orchestration/risk.ts`
- Modify: `src/orchestration/policy.ts`
- Modify: `src/orchestration/declaration.ts`

- [ ] **Step 1: Write failing route tests**

Add observable cases for:

- settled, low-uncertainty `auto` work selecting `solo`;
- public or user-visible work not forcing review by itself;
- material consequence plus material uncertainty selecting `audit` when the
  architect keeps implementation;
- delegation requiring concrete value and a selected available implementer;
- missing optional implementer falling back visibly to `solo`;
- missing required reviewer failing closed; and
- `thorough` retaining independent review without forcing delegation.

- [ ] **Step 2: Prove RED**

Run:

```bash
npm run build
node --test dist/orchestration/__tests__/risk.test.js \
  dist/orchestration/__tests__/policy.test.js \
  dist/orchestration/__tests__/declaration.test.js
```

Expected: failures show the old delegate/full default and missing thin-kernel
fields.

- [ ] **Step 3: Implement the smallest green policy**

Add `Consequence`, `Uncertainty`, delegation-value, capability, fallback, and
execution-budget types. Keep selection deterministic. Preflight metadata must
describe only the selected auxiliary. The policy must throw a typed error when
fresh review is required but unavailable.

- [ ] **Step 4: Prove GREEN**

Re-run the focused command. Expected: all focused orchestration tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestration
git commit -m "feat: make OMCS routing solo first"
```

---

### Task 3: Enforce the thin prompt contract with TDD

**Files:**

- Modify: `src/catalog/__tests__/skills.test.ts`
- Modify: `skills/omcs/SKILL.md`
- Modify: `plugins/oh-my-codex-slim/skills/omcs/SKILL.md`
- Modify: selected `prompts/omcs-*.md` files only when needed for ownership,
  evidence, or stop-rule consistency

- [ ] **Step 1: Write failing prompt-contract tests**

Require the canonical skill to state:

- solo is the default in `auto` and `fast`;
- consequence and uncertainty are separate;
- a selected auxiliary substitutes for primary-context work;
- `auto` uses at most one auxiliary;
- only the selected auxiliary is capability-checked;
- missing optional capability reroutes narrow work to `solo`;
- focused skills load only on a named trigger;
- cleanup requires a concrete finding; and
- acceptance evidence is a binding stop condition.

Forbid mandatory `omcs config show`, automatic anti-slop, and unconditional
full lifecycle wording.

- [ ] **Step 2: Prove RED**

Run:

```bash
npm run build
node --test dist/catalog/__tests__/skills.test.js
```

Expected: the existing ceremony-heavy prompt fails the new contract.

- [ ] **Step 3: Rewrite the entry skill as a thin kernel**

Use the already supplied effective profile or in-memory `auto` defaults. Keep
the route declaration, ownership packet, evidence boundary, and fail-closed
review contract. Move discipline details to focused skills and remove automatic
no-op phases.

- [ ] **Step 4: Synchronize and prove GREEN**

Run:

```bash
npm run sync:skills
npm run build
node --test dist/catalog/__tests__/skills.test.js \
  dist/catalog/__tests__/skill-sync.test.js
npm run verify:skills
```

Expected: source and plugin skill copies match and the new prompt contract
passes.

- [ ] **Step 5: Commit**

```bash
git add src/catalog/__tests__/skills.test.ts skills \
  plugins/oh-my-codex-slim/skills prompts
git commit -m "refactor: make OMCS orchestration progressive"
```

---

### Task 4: Align configuration, receipts, and public contracts

**Files:**

- Modify: `src/config/omcs-config.ts` only if the budget becomes configurable
- Modify: `schema/omcs.schema.json` only with matching configuration tests
- Modify: `src/orchestration/receipt.ts` only if a new safe receipt field is
  required
- Modify: relevant tests under `src/config/__tests__/` and
  `src/orchestration/__tests__/`

- [ ] **Step 1: Prefer an internal policy budget**

Keep the version-one public configuration unchanged unless runtime behavior
cannot express the approved budget safely. Do not add knobs solely because the
implementation has an internal invariant.

- [ ] **Step 2: Add any required failing compatibility tests**

Prove existing configuration and receipt inputs continue to validate. If the
public schema changes, first prove the precise new field fails and unknown or
secret-bearing fields remain rejected.

- [ ] **Step 3: Implement and verify compatibility**

Run the focused config and receipt suites. Expected: existing version-one files
remain valid and declarations/receipts expose no secret, prompt, model, or path
data.

- [ ] **Step 4: Commit if production files changed**

```bash
git add src/config schema src/orchestration/receipt.ts \
  src/config/__tests__ src/orchestration/__tests__/receipt.test.ts
git commit -m "fix: preserve thin-kernel policy contracts"
```

---

### Task 5: Update documentation, diagrams, and attribution

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/execution-modes.md`
- Modify: `docs/agents-and-skills.md`
- Modify: `docs/examples.md`
- Modify: `docs/benchmarking.md`
- Modify: `docs/upstream-sources.md`
- Modify: `docs/diagrams/omcs-routing.mmd`
- Modify: `docs/assets/omcs-routing.svg`
- Modify: docs verification tests only when the documented contract changes

- [ ] **Step 1: Write failing documentation assertions where practical**

Require public docs to describe solo-first `auto`, one auxiliary, explicit
capability fallback, consequence-plus-uncertainty review, finding-triggered
cleanup, and the binding stop condition. Preserve published benchmark values,
limitations, and author names.

- [ ] **Step 2: Update the public story**

Explain where OMCS should win, where it deliberately behaves like direct Codex,
and how the next paired benchmark will test the redesign. Do not claim gains
before the approved rerun exists.

- [ ] **Step 3: Regenerate or hand-update the neutral route diagram**

Keep the existing monochrome editorial style and accessible title/description.
The diagram must show `solo` as the default, one optional auxiliary, and fresh
review only at the approved risk gate.

- [ ] **Step 4: Verify documentation and immutable benchmark evidence**

Run:

```bash
npm run verify:docs
npm run build
node --test dist/scripts/__tests__/benchmark-publication.test.js
git diff --check
```

Expected: docs/assets pass, frozen benchmark publication tests pass, and no
whitespace errors exist.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: explain the OMCS thin kernel"
```

---

### Task 6: Run complete non-billed verification

**Files:**

- Modify only if a gate exposes a proven defect; add a focused regression test
  before each fix.

- [ ] **Step 1: Run focused static and test gates**

```bash
npm run lint
npm test
npm run verify:skills
npm run verify:docs
npm run verify:secrets
```

- [ ] **Step 2: Run the offline release verifier**

```bash
npm run verify:release
```

Expected: all offline acceptance gates pass and no model/provider command is
executed.

- [ ] **Step 3: Prove the published benchmark stayed frozen**

Re-run the publication/hash test and compare the checked-in result SHA-256 with
`9eddd9611ba163263d802de1d3754256faf833461331cb2003682fb419cb7eb3`.

- [ ] **Step 4: Inspect final repository state**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -12
```

Expected: only intentional changes, focused commits, no sensitive data, and no
untracked benchmark outputs.

---

### Task 7: Fresh final review and publication

**Files:**

- Modify only for a proven review finding. Every edit requires a regression
  test and fresh verification.

- [ ] **Step 1: Perform a fresh read-only specification review**

Read the approved thin-kernel spec, full diff, prompt contract, route tests,
public docs, and verification evidence. Return `ship`, `fix-first`, or
`rethink` with file and line evidence.

- [ ] **Step 2: Perform a fresh security/privacy review**

Inspect capability metadata, declarations, receipts, public docs, package
contents, and secret-scan output. Confirm no provider credential or external
transport mutation was introduced.

- [ ] **Step 3: Re-run affected and complete gates after any correction**

Any post-review edit invalidates prior evidence. Re-run focused tests, the full
suite, release verification, and the fresh review.

- [ ] **Step 4: Push verified commits**

```bash
git push origin main
```

Expected: the public `main` branch advances without force. Do not push private
or rollback branches.

- [ ] **Step 5: Report exact evidence boundaries**

Report the implemented policy, tests and offline gates, frozen benchmark state,
review verdict, pushed commit, and the explicit fact that no billed model
benchmark was run. A later paid paired evaluation still requires separate
approval.
