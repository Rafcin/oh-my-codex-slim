# OMCS Orchestration Experience Design

**Date:** 2026-08-26

**Status:** Approved

## 1. Purpose

Oh My Codex Slim must be an orchestration product, not merely a collection of
agent files and skills. When a user says “use OMCS to solve this issue” or
invokes the OMCS entry skill, the current Codex task must automatically adopt a
small, observable, risk-gated engineering workflow.

The experience combines:

- Sol Advisor's selective routing, explicit ownership, parent verification,
  and fresh-review discipline;
- selected engineering practices from Matt Pocock's skills, including focused
  grilling, domain language, deep-module design, TDD, implementation, and
  two-axis review;
- the understandable specialist roster and work-graph presentation of Oh My
  OpenCode Slim; and
- behavioral lessons only from Oh My OpenAgent. Its Sustainable Use licensed
  implementation must not be copied or adapted.

OMCS remains Codex-native. It does not install an OpenCode runtime, LazyCodex,
tmux, a daemon, telemetry, or a second credential store. OpenCodex remains the
only supported external-model transport and owns all provider credentials,
accounts, routing, and service state.

## 2. Product principles

1. **One obvious entrypoint.** Users ask to use OMCS; they do not manually
   assemble agents and skills.
2. **Selective orchestration.** A small task stays small. Delegation and review
   must earn their cost through risk reduction or critical-path improvement.
3. **Architect-owned delivery.** The primary task owns intent, architecture,
   route choice, decomposition, parent verification, and acceptance.
4. **Adaptive engineering discipline.** OMCS activates only the clarification,
   design, implementation, cleanup, verification, and review gates the task
   needs.
5. **Visible decisions.** Every run reports its profile, internal route, skills,
   agents, approval policy, and risk rationale before task work.
6. **Evidence over claims.** Worker reports are inputs. The primary task
   inspects the actual change and reruns relevant verification.
7. **Slim by subtraction.** No scheduler service, dashboard runtime, provider
   SDK, alternate agent harness, or hidden background loop is added.
8. **Ownership-safe configuration.** Shared policy may be checked in. Personal
   preferences and all provider state remain private.
9. **Exact attribution.** Every adapted or materially consulted upstream source
   is pinned and credited using its published author or owner identity.

## 3. User journey

### 3.1 Invocation

The plugin exposes a primary `omcs` skill. Its description must make these
phrases activate it naturally:

- “Use OMCS to solve this issue.”
- “Use Oh My Codex Slim for this.”
- `$oh-my-codex-slim:omcs`

The plugin's default prompt demonstrates the first form. The existing focused
skills remain discoverable, but users do not need to name them during a normal
OMCS run.

### 3.2 First use

When neither project nor global configuration exists, the workflow offers:

1. **Configure this project (recommended):** create checked-in
   `omcs.config.json` containing only portable team policy.
2. **Configure globally:** write private preferences below
   `${CODEX_HOME}/oh-my-codex-slim/`.
3. **Use for this session:** apply safe defaults without writing files.

Configuration precedence is:

```text
session override
    ↓
nearest omcs.config.json
    ↓
global OMCS preferences
    ↓
built-in safe defaults
```

Project discovery walks from the working directory to the Git root and stops
there. It does not cross the repository boundary or follow symbolic links.

### 3.3 Execution

An activated run performs this adaptive flow:

```text
intent
  ↓
configuration and route declaration
  ↓
context / ambiguity gate
  ↓
repository exploration and current research
  ↓
design and material-decision gate
  ↓
plan at agreed interfaces and seams
  ↓
TDD implementation
  ↓
anti-slop and simplification inspection
  ↓
fresh verification
  ↓
risk-gated review
  ↓
evidence-backed acceptance
```

The pipeline is conditional. A settled one-file fix may go directly from route
declaration to TDD and verification. A new subsystem may use every stage.

## 4. Configuration

### 4.1 Checked-in project policy

The canonical default file is:

```json
{
  "$schema": "https://raw.githubusercontent.com/Rafcin/oh-my-codex-slim/main/schema/omcs.schema.json",
  "version": 1,
  "profile": "auto",
  "approval": "material-decisions",
  "quality": {
    "clarification": "adaptive",
    "design": "adaptive",
    "tdd": "adaptive",
    "review": "risk-gated",
    "antiSlop": "changed-files"
  },
  "orchestration": {
    "maxParallel": 2,
    "council": "explicit-only"
  }
}
```

The schema is shipped at `schema/omcs.schema.json`. The remote URL supports
editors in repositories that do not install OMCS as a local dependency.

### 4.2 Global preferences

Global preferences use the same public policy fields and live at
`${CODEX_HOME}/oh-my-codex-slim/config.json`. The implementation must reject
unknown keys and keys associated with secrets, providers, accounts, tokens,
URLs containing credentials, model credentials, or arbitrary command paths.

OMCS does not store personal model pins in version 1. Native agent role files
own the supported default model and effort. OpenCodex owns any external-model
selection.

### 4.3 Effective configuration

The CLI provides:

```text
omcs configure [--scope project|global|session] [--profile auto|fast|thorough|council] [--update] [--dry-run] [--json]
omcs config show --effective [--json]
omcs config validate [path] [--json]
```

`configure` preflights every target, refuses unsafe links or ambiguous
ownership, writes atomically, and preserves existing unrelated files. Project
configuration is an exact OMCS-owned file; an existing differing file is
reported and is not overwritten unless `--update` is explicit and the existing
file is valid version-1 OMCS configuration. Dry-run and JSON output are
required.

Session configuration is workflow context only; the CLI reports the resolved
defaults but does not persist session state.

## 5. Profiles and routes

### 5.1 User-facing profiles

| Profile | Contract |
|---|---|
| `auto` | Default. Scale clarification, design, delegation, testing, cleanup, and review to observed risk. |
| `fast` | Prefer direct work or one efficient implementer. Keep required correctness and safety verification. |
| `thorough` | Raise design, TDD, anti-slop, documentation, verification, and fresh-review gates. |
| `council` | Explicit-only, read-only multi-model consultation before choosing a normal delivery route. |

Council is an advisory overlay, not a delivery route. It must never activate
from `auto`, `fast`, or `thorough`. It may use only distinct model lanes proven
available by supported, non-secret runtime metadata. If diversity cannot be
proved, it fails closed and offers the normal native route.

### 5.2 Internal delivery routes

| Route | Delivery |
|---|---|
| `solo` | Architect plans, implements, verifies, and self-reviews. No auxiliary agent. |
| `delegate` | One selected implementer executes a complete bounded packet. Architect verifies. |
| `audit` | Architect implements and verifies. Fresh read-only reviewer audits. |
| `full` | One selected implementer executes. Architect verifies. Fresh read-only reviewer audits. |

Supporting Explorer, Librarian, and Oracle work does not change the delivery
route. They advise or compress context; they never become acceptance owners.

### 5.3 Route declaration

After configuration resolution and before task work tools, the entry skill
emits:

```text
OMCS ROUTE
profile: auto
mode: full
risk: new subsystem with public interfaces and persistent configuration
skills: context, codebase-design, plan, tdd, verification, code-review
agents: architect → explorer + librarian → terra-fixer → reviewer
approval: material-decisions
```

The declaration must be concise, task-specific, and machine-auditable. A route
may escalate when new evidence demonstrates greater risk or complexity. It may
not silently downgrade.

## 6. Native agent team

OMCS installs exactly eight native roles:

| Role | Default | Responsibility |
|---|---|---|
| `omcs_architect` | Sol / High | Own intent, architecture, routing, decomposition, parent verification, and acceptance. |
| `omcs_explorer` | Luna / Low | Fast read-only repository and symbol mapping. |
| `omcs_librarian` | Luna / Medium | Read-only primary-source and dependency research. |
| `omcs_oracle` | Sol / High | Read-only difficult diagnosis and architecture advice. |
| `omcs_fixer` | Luna / Max | Routine, fully specified implementation. |
| `omcs_terra_fixer` | Terra / High | Judgment-heavy or wider-blast-radius implementation. |
| `omcs_designer` | Terra / High | User-facing design, implementation, and visual proof. |
| `omcs_reviewer` | Sol / High, read-only requested | Fresh specification and quality review. |

The primary task may use independent read-only discovery concurrently. Two
write-capable agents never receive overlapping ownership. Default concurrency
is two and may be reduced by configuration or available slots.

Every implementer packet contains:

1. Objective and observable outcome.
2. Exact files and ownership.
3. Interfaces and compatibility requirements.
4. Constraints and explicit exclusions.
5. Verification commands and expected evidence.

The packet also states that other agents or the user may be editing
concurrently, prohibits reverting unrelated work, and requires a structured
implementation report. Missing or conflicting role/model/effort evidence stops
the selected lane. OMCS does not silently substitute a different role.

A reviewer is fresh and behaviorally read-only. It reviews the actual
accumulated change against both the approved specification and repository
quality standards, returning `ship`, `fix-first`, or `rethink`. A correction
invalidates the verdict and requires parent re-verification plus a new fresh
review when the route includes review.

## 7. Adaptive skill catalog

### 7.1 Entrypoint

The new `omcs` skill owns routing and composes focused disciplines. It replaces
`omcs-orchestrate` as the primary public name; `omcs-orchestrate` remains a
compatibility alias that points to `omcs` without duplicating the workflow.

### 7.2 Core disciplines

| Skill | Trigger and responsibility |
|---|---|
| `context` | Material ambiguity or project-specific terminology. One focused question at a time; update `CONTEXT.md` or a concise ADR only when warranted. |
| `codebase-design` | New or changed module interfaces and seams. Prefer deep modules, locality, leverage, and tests at public interfaces. |
| `research` | Current or unfamiliar external behavior. Use pinned primary sources and distinguish evidence from inference. |
| `plan` | Multi-step, delegated, persistent, or risky work. Define exact files, interfaces, tests, and ownership. |
| `tdd` | Observable behavior change or regression. Red-green in vertical slices at agreed seams. |
| `implement` | Execute an approved plan using the selected route and TDD discipline. |
| `ai-slop-cleaner` | Inspect changed files for concrete generated noise, speculative abstraction, masking fallbacks, duplication, or dead paths. |
| `simplify` | Reduce correct changed code without changing behavior. |
| `verification` | Prove acceptance criteria with fresh evidence. Always required before completion. |
| `code-review` | Fresh two-axis specification and quality review when the route or profile requires it. |

Existing focused `codemap`, `diagnose`, `deepwork`, and `deep-interview` names
remain available. Their reusable rules are referenced from the primary flow
rather than copied into every skill.

### 7.3 Anti-slop safety

Anti-slop is an automatic inspection for `thorough`, `audit`, and `full`, and
for other routes when concrete smells appear. It is not permission for a broad
rewrite. Any edit must:

- stay inside the accumulated changed-file scope;
- preserve observable behavior;
- remove a concrete identified smell;
- avoid new dependencies and speculative abstractions; and
- rerun affected tests and static checks.

It runs before final review so its edits cannot invalidate the reviewer verdict.

## 8. Approval policy

With `approval: material-decisions`, OMCS pauses only when a choice changes:

- user-visible behavior or accepted scope;
- persistent data or configuration contracts;
- public interfaces or compatibility;
- security, privacy, or credential ownership;
- architecture, module seams, or dependencies; or
- irreversible or costly external state.

Routine implementation choices remain autonomous. Existing tool-level approval
requirements still apply independently.

## 9. Runtime records and observability

OMCS adds no daemon and no telemetry. The primary task communicates progress in
normal Codex commentary. A concise status block may be rendered as:

```text
OMCS · AUTO · FULL

Understanding     complete
Design            approved
Implementation    terra-fixer
Anti-slop         2 concrete issues removed
Verification      34 tests passed
Review            ship
```

Optional task-local receipts live below ignored `.omcs/runs/`. They contain
only non-secret policy and evidence summaries:

```ts
interface OrchestrationReceipt {
  schemaVersion: 1;
  profile: "auto" | "fast" | "thorough" | "council";
  route: "solo" | "delegate" | "audit" | "full";
  skills: string[];
  agents: string[];
  approval: "material-decisions";
  verification: Array<{ command: string; outcome: "passed" | "failed" }>;
  review?: { verdict: "ship" | "fix-first" | "rethink" };
}
```

Receipts must not contain prompts, source code, environment variables,
credentials, provider metadata, absolute user paths, raw command output, or
model responses. They are advisory local evidence, not a hidden execution
engine.

## 10. Documentation and visuals

The README leads with the orchestration experience and contains:

- the one-line invocation;
- a real route-declaration screenshot;
- an orchestration flow diagram;
- profile comparison;
- the native agent roster;
- the adaptive skill pipeline;
- project/global/session configuration;
- OpenCodex and privacy boundaries;
- direct Codex versus OMCS-managed examples; and
- exact upstream attribution.

Supporting documentation includes:

```text
docs/
├── getting-started.md
├── orchestration.md
├── execution-profiles.md
├── agents.md
├── skills.md
├── configuration.md
├── examples/
│   ├── bug-fix.md
│   ├── new-feature.md
│   ├── architecture-change.md
│   └── visual-feature.md
├── diagrams/
│   ├── orchestration-flow.mmd
│   ├── orchestration-flow.svg
│   ├── route-selection.mmd
│   ├── route-selection.svg
│   ├── agent-team.mmd
│   └── agent-team.svg
└── screenshots/
    ├── first-run-configuration.png
    ├── route-declaration.png
    └── verified-completion.png
```

Screenshots must come from deterministic non-billed CLI or App fixtures. They
must contain no user paths, credentials, provider names, account state, or
fabricated model results. Mermaid sources accompany SVG exports. The repository
does not add a documentation site runtime in this release.

## 11. Upstream provenance index

`docs/upstream/orchestration-source-index.md` records every inspected source
with repository, exact revision, published author/owner, license, source path,
decision, OMCS destination, and material modifications.

The initial index includes:

- `DannyMac180/sol-advisor` at
  `37b75cad535abdd46531f0227483a8842d045ab8`, MIT, author Daniel McAteer;
- `mattpocock/skills` at
  `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`, MIT, author Matt Pocock;
- `alvinunreal/oh-my-opencode-slim` at
  `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`, MIT,
  published owner/author identity Alvin (`alvinunreal`); and
- `code-yeongyu/oh-my-openagent` at
  `b48ab1086b338921ccd99a11183f91eefbb169f2`, Sustainable Use License,
  behavioral reference only.

Adapted skill files repeat their own source path, revision, author/owner,
license, and modified status in `THIRD_PARTY_NOTICES.md`. No personal name is
invented when upstream publishes only a handle or collective contributor name.

## 12. Error handling

OMCS fails closed when:

- configuration is invalid, unknown, unsafe, or crosses repository ownership;
- a requested agent role or exact model/effort contract cannot be verified;
- council diversity cannot be proven without secret inspection;
- reviewer isolation is required but unavailable or contradicted by observed
  runtime metadata;
- a write scope overlaps another active writer;
- verification fails or evidence is stale; or
- a material decision has not been approved.

Failure of an optional specialist may fall back to architect-owned work only
when that does not silently change the declared route, model contract, or risk
posture. The change and reason must be reported.

## 13. Testing and release gates

Implementation uses TDD at these public seams:

1. Parse and validate project/global configuration.
2. Resolve precedence without crossing the Git root.
3. Map profiles and risk inputs to deterministic routes and skill gates.
4. Render auditable route declarations and safe receipts.
5. Generate exact native agent definitions and compatibility aliases.
6. Validate skill metadata, provenance, and non-duplicated composition.
7. Enforce documentation assets, links, diagrams, and screenshot redaction.
8. Pack only intended runtime, schemas, skills, docs, and assets.

Required non-billed gates are:

```text
npm run lint
npm test
npm run verify:skills
npm run verify:release
```

Fresh plugin discovery and CLI installation are separate local integration
gates. A real model prompt or provider smoke test remains quota-consuming and
requires explicit approval for that specific test.

## 14. Non-goals

This release does not add:

- an OpenCode or LazyCodex runtime;
- provider credential discovery, copying, or storage;
- automatic external-model promotion;
- a daemon, scheduler service, tmux, or telemetry;
- a live dashboard or separate desktop companion;
- automatic council execution;
- arbitrary custom agent/model configuration;
- silent project file overwrites;
- real-model acceptance tests; or
- copied Oh My OpenAgent implementation or prompt text.

## 15. Acceptance criteria

The release is accepted when:

1. A fresh user can install OMCS, say “use OMCS,” and understand the resulting
   route without naming individual skills or agents.
2. First use offers project, global, or session configuration.
3. Checked-in `omcs.config.json` validates against the shipped schema and cannot
   contain credentials or provider configuration.
4. `auto`, `fast`, `thorough`, and explicit-only `council` have deterministic,
   tested policy effects.
5. The architect composes context, design, planning, TDD, cleanup,
   verification, and review adaptively.
6. Native implementer and reviewer packets enforce exact ownership,
   verification, and fresh-review contracts.
7. The README and supporting docs contain accurate diagrams, real redacted
   non-billed screenshots, examples, and execution-mode guidance.
8. Every adapted source names its exact upstream revision, license, published
   author or owner, and modification status.
9. OpenCodex remains the only supported external-model transport and no
   credential value is read, logged, transferred, or stored.
10. Every offline release gate passes from a clean checkout, and no billed model
    smoke test is run without separate approval.
