# OMCS Thin-Kernel Orchestration Design

**Date:** 2026-08-27

**Status:** Approved

## 1. Purpose

The first valid paired benchmark showed that OMCS preserved high task quality,
but did not improve it: plain Codex passed 16 of 18 tasks (88.9%) while OMCS
passed 15 of 18 (83.3%). OMCS also used 1.99 times the wall time and 3.25 times
the tokens, with one 56-minute timeout. The treatment selected `full` for 16 of
18 tasks, attempted an unavailable configuration command in every task, and
often continued after sufficient acceptance evidence existed.

This design replaces that ceremony-heavy default with a thin routing kernel.
OMCS remains a disciplined Codex-native engineering workflow, but orchestration
must earn its cost. A settled task stays in the primary context unless an
auxiliary can remove a concrete bottleneck or an independent reviewer is
justified by both consequence and uncertainty.

The published pilot remains frozen development evidence. It is not reused as a
held-out proof set, and its graders, fixtures, reference solutions, or expected
outputs must not be changed to make the treatment score better.

## 2. Goals

1. Make `auto` select `solo` for ordinary settled work.
2. Separate task consequence from evidence uncertainty.
3. Use at most one auxiliary lane in `auto` and `fast`.
4. Make an auxiliary substitute for primary-context work instead of duplicating
   it.
5. Load focused skills only when their trigger is present.
6. Make missing optional capabilities fall back explicitly and safely.
7. Stop immediately when acceptance evidence holds.
8. Preserve independent scrutiny for `thorough` and explicit-only `council`.
9. Keep exact upstream attribution and the OpenCodex credential boundary.
10. Improve measured quality and efficiency without weakening graders, tests,
    safety checks, or task requirements.

## 3. Non-goals

This change does not:

- add a scheduler, daemon, alternate agent runtime, telemetry, or terminal
  multiplexer;
- install an OpenCode runtime or LazyCodex;
- change OpenCodex provider, account, credential, or service ownership;
- silently substitute a reviewer when fresh independent review is required;
- run a billed model benchmark without separate explicit approval;
- copy source code or prompt text from Oh My OpenAgent; or
- remove focused OMCS skills that remain useful when explicitly triggered.

## 4. Design influences and attribution boundary

The redesign is an original OMCS synthesis informed by these pinned sources:

| Source | Published author or owner | Applied principle |
| --- | --- | --- |
| `mattpocock/skills` | Matt Pocock | Progressive disclosure, tight feedback loops, phase boundaries, public-interface tests, and two-axis review. |
| `DannyMac180/sol-advisor` | Daniel McAteer | Solo-first routing, bounded ownership, one useful auxiliary, parent verification, and fresh independent review. |
| `alvinunreal/oh-my-opencode-slim` | Alvin (`alvinunreal`) | Understandable specialist lanes, bounded packets, and capability-focused prompts. |
| `code-yeongyu/oh-my-openagent` | YeonGyu-Kim | Behavioral research only: concise, outcome-first, principle-driven prompts for newer Codex models. |
| `Yeachan-Heo/oh-my-codex` | Yeachan Heo | Codex-native execution and prompt guidance retained by the attributed fork. |

Exact revisions, licenses, paths, and adaptation status remain in
`THIRD_PARTY_NOTICES.md`, `.upstream-revisions.json`, and
`docs/upstream-sources.md`. Oh My OpenAgent is Sustainable Use licensed and
remains a behavioral reference only; no implementation or prompt wording is
copied.

## 5. Thin routing model

### 5.1 Independent axes

Routing observes separate signals:

- **Consequence:** `low` or `material`. Material consequence includes security,
  credentials, irreversible or external state, persistent data, public
  compatibility, dependencies, or architecture. User-visible documentation or
  a public API is not by itself enough to require independent review when the
  change is narrow, well specified, and strongly verified.
- **Uncertainty:** `low` or `material`. Material uncertainty means requirements,
  interfaces, root cause, acceptance oracle, or available evidence are not yet
  strong enough for a bounded implementation.
- **Blast radius:** `narrow`, `moderate`, or `wide`.
- **Delegation value:** true only when a complete bounded packet would remove a
  real critical-path bottleneck or exploit a specialist capability. It is not
  synonymous with “can be delegated.”

Independent review is required in `auto` when material consequence combines
with material uncertainty or a wide change. `thorough` and `council` always
retain fresh independent review. Low-consequence or well-proven work does not
earn review solely because it is user-visible or public.

### 5.2 Route selection

The delivery routes remain `solo`, `delegate`, `audit`, and `full`:

1. `auto` and `fast` default to `solo`.
2. Unsettled work remains primary-context owned while ambiguity is resolved.
3. `delegate` is selected only for settled work with concrete delegation value
   and an available implementer.
4. `audit` is primary-context implementation plus a fresh reviewer.
5. `full` is a selected implementer plus primary verification plus a fresh
   reviewer.
6. `thorough` and `council` keep review, but delegation still requires a
   worthwhile bounded packet.
7. `council` remains an explicit-only, read-only advisory overlay and never
   becomes an implementation route.

## 6. Capability preflight and fallback

The primary context does not enumerate or probe every possible role before
routing. It first selects at most one auxiliary candidate and only then checks
whether that exact capability is available.

- If an optional Explorer, Librarian, Oracle, Designer, Fixer, or Terra Fixer is
  unavailable, `auto` and `fast` visibly reroute narrow work to `solo`.
- No replacement auxiliary is tried automatically in the same run.
- If fresh independent review is required and Reviewer is unavailable, the run
  fails closed with the exact missing capability.
- `council` fails closed when two distinct proven advisory lanes are
  unavailable.
- Capability checks use non-secret runtime metadata. OMCS never discovers,
  reads, transfers, or logs provider credentials.

## 7. Orchestration budget

Each execution policy exposes a binding budget:

| Profile | Auxiliary budget | Review | Skill loading |
| --- | --- | --- | --- |
| `auto` | At most one | Risk-gated | Triggered only |
| `fast` | At most one | Only when the same safety condition requires it | Triggered only |
| `thorough` | At most one delivery auxiliary plus one reviewer | Always | Triggered plus thorough evidence gates |
| `council` | Explicit read-only advisers, then the `thorough` delivery budget | Always | Same as thorough |

An auxiliary substitutes for work the primary context would otherwise perform.
The primary must not repeat repository mapping, research, implementation, or
review already delegated except to inspect the returned evidence at the
acceptance boundary.

The policy also binds these execution rules:

- one final verification path, proportionate to the acceptance claim;
- no repeated command unless relevant inputs changed or the prior result was
  incomplete;
- anti-slop is a finding-triggered correction, not a mandatory no-op phase;
- once acceptance evidence is green, stop; and
- no post-green edit without a named unresolved finding. Any such edit
  invalidates affected verification and review.

## 8. Progressive skill disclosure

The core OMCS prompt contains only routing, ownership, evidence, capability
fallback, and stop rules. Focused skill instructions are loaded on demand:

- `context` or `deep-interview` for material ambiguity;
- `codemap` or Explorer for a real repository-mapping bottleneck;
- `research` or Librarian for current external behavior;
- `diagnose` or Oracle for a reproducible difficult defect;
- `codebase-design` for material interface or architecture decisions;
- `plan` for multi-step, delegated, persistent, or risky work;
- `tdd` for observable behavior changes and regressions;
- `ai-slop-cleaner` only when a concrete changed-file smell is named;
- `simplify` only for a justified behavior-preserving reduction;
- `verification` for the final evidence path; and
- `code-review` when the route requires fresh independent review.

Skill activation is not a lifecycle checklist. A settled small fix can use TDD
and verification without loading design, planning, cleanup, or review.

## 9. Prompt contract

The entry skill must:

1. use an already supplied effective profile, otherwise apply the built-in
   `auto` default in memory;
2. never require `omcs config show` before task tools;
3. classify consequence, uncertainty, blast radius, and delegation value;
4. declare the route concisely;
5. select no auxiliary by default;
6. preflight only the selected auxiliary;
7. state that delegated work substitutes for primary-context work;
8. load focused skills only when triggered;
9. require one final evidence path; and
10. stop after acceptance evidence holds.

The route may escalate when new evidence changes consequence, uncertainty, or
scope. It may simplify to `solo` only through the explicit optional-capability
fallback defined above, and that reroute must be visible.

## 10. Policy data contract

The TypeScript policy model adds:

```ts
type Consequence = "low" | "material";
type Uncertainty = "low" | "material";

interface WorkSignals {
  settled: boolean;
  consequence: Consequence;
  uncertainty: Uncertainty;
  blastRadius: "narrow" | "moderate" | "wide";
  delegationValue: boolean;
  // focused task signals remain
}

interface CapabilityMetadata {
  available: readonly AgentName[];
}

interface ExecutionBudget {
  maxAuxiliaries: 1;
  oneFinalVerificationPath: true;
  repeatVerificationOnlyAfterInputChange: true;
  postGreenEdits: "named-finding-only";
}
```

The execution policy records the selected auxiliary, explicit fallback reason,
triggered skills, review requirement, and budget. Route declarations render
only allowlisted non-secret fields.

## 11. Benchmark and tuning discipline

The existing pilot is immutable development evidence. Offline policy and prompt
contract tests drive this implementation. A later paired model benchmark
requires separate explicit user approval and must preserve randomized order,
matched sandboxes, hidden grading, frozen fixtures, and transcript activation
audits.

Targets for the next approved benchmark are:

- narrow tasks: quality within 3 percentage points of plain Codex, time and
  tokens no more than 1.25 times control;
- complex tasks: quality at least 5 percentage points above control, time and
  tokens no more than 1.75 times control; and
- all tasks: zero safety failures and zero orchestration timeouts.

Results must publish gains, losses, uncertainty, sample size, and limitations.
No result may be called a performance improvement from one run or an unfrozen
grader.

## 12. Acceptance criteria

The redesign is accepted when:

1. policy tests prove `auto` and `fast` select `solo` for settled low-uncertainty
   work even when the surface is user-visible or public;
2. policy tests prove review requires the approved consequence-plus-uncertainty
   condition, except in `thorough` and `council`;
3. delegation requires concrete value and an available selected implementer;
4. missing optional implementers visibly fall back to `solo`, while a missing
   required reviewer fails closed;
5. `auto` exposes an auxiliary budget of one;
6. prompt contract tests reject mandatory CLI preflight, automatic cleanup, and
   post-green continuation;
7. docs, diagrams, examples, and attribution describe the implemented policy;
8. all focused, full, skill, docs, secret, and offline release gates pass;
9. the frozen benchmark result and hash remain unchanged; and
10. no billed model call is made.
