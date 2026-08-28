---
name: omcs
description: Use when a substantial engineering task needs OMCS risk-gated orchestration, including when the user says use OMCS to solve this issue.
---

# OMCS

OMCS is a thin routing kernel for one evidence-led delivery run. The primary
context owns intent, routing, integration, verification, and acceptance.
Orchestration must remove a concrete bottleneck or reduce a material risk.

## Entry conditions

Use an effective profile already supplied by the runtime or current request.
Otherwise apply the built-in `auto` defaults in memory. Only an explicit user
choice selects `fast`, `thorough`, or `council`; urgency language is not a
profile override. Do not require a CLI configuration command to begin work.

Classify only observable signals:

- `settled` means requirements, owned scope, interfaces, and acceptance oracle
  are sufficient for bounded execution.
- Consequence is separate from uncertainty. Consequence is `material` for
  security, credentials, irreversible or external state, persistent data,
  dependencies, architecture, or compatibility with meaningful downstream
  impact. A narrow public or user-visible surface is not material by default.
- Uncertainty is `material` when requirements, root cause, interfaces, or
  acceptance evidence are weak. Otherwise it is `low`.
- Blast radius is `narrow`, `moderate`, or `wide` from the actual changed
  surfaces and downstream consumers.
- `delegationValue` is true only when a complete bounded packet removes a real
  critical-path bottleneck or needs a specialist capability. Being technically
  delegable is not enough.

Apply the smallest sufficient route:

- `auto` and `fast` default to `solo`.
- Require fresh review in `auto` or `fast` only when material consequence
  combines with material uncertainty or wide blast radius.
- A one-auxiliary review route is `audit`: the primary implements and a fresh
  `omcs_reviewer` audits.
- Select `delegate` only for settled, low-uncertainty work with concrete
  delegation value. Choose visual work → `omcs_designer`, wide non-visual work
  → `omcs_terra_fixer`, otherwise → `omcs_fixer`.
- `thorough` and `council` always retain fresh review. They use `full` only when
  the same delegation-value test passes; otherwise they use `audit`.
- `auto` and `fast` use at most one auxiliary. `thorough` may use one
  implementer plus one reviewer. Council advisers are explicit, read-only, and
  do not implement.

After selecting an auxiliary candidate, preflight only the selected auxiliary.
If an optional implementer or supporting specialist is unavailable, reroute
narrow work visibly to `solo` and do not try another lane. If required fresh
review is unavailable, fail closed with the missing capability. Council also
fails closed unless two distinct advisory lanes are proven from non-secret
metadata.

Declare the result before mutation or delegation; a minimal read-only
inspection needed to classify the task is allowed:

```text
OMCS ROUTE
profile: auto | fast | thorough | council
mode: solo | delegate | audit | full
risk: <consequence; uncertainty; blast radius>
skills: <triggered skills>
agents: <primary and selected auxiliaries>
budget: <auxiliary limit; one final verification path; stop after green>
approval: material-decisions
```

## Scope limit

Load focused skills only after a named trigger:

- material ambiguity → `context` or `deep-interview`;
- repository-mapping bottleneck → `codemap` or `omcs_explorer`;
- current external behavior → `research` or `omcs_librarian`;
- difficult reproducible diagnosis → `diagnose` or `omcs_oracle`;
- material interface decision → `codebase-design`;
- multi-step, delegated, persistent, or risky work → `plan`;
- observable behavior change or regression → `tdd`;
- concrete changed-file smell → `ai-slop-cleaner`;
- justified behavior-preserving reduction → `simplify`;
- final acceptance proof → `verification`; and
- a review route → `code-review`.

An auxiliary substitutes for the corresponding primary-context work; do not
repeat its mapping, research, implementation, or review. Inspect its evidence
only at the integration or acceptance boundary. Every delegation packet states
objective, exact ownership, interfaces, exclusions, required evidence, and
concurrent-work preservation. The primary never accepts a worker summary in
place of inspecting the actual result.

Pause only for a material decision that changes accepted scope, persistent or
public contracts, security or credential ownership, architecture, dependencies,
or irreversible external state. OpenCodex owns external transport and provider
credentials.

## Exit evidence

Use one final verification path proportionate to the acceptance claim. Repeat a
command only after relevant inputs changed or when its prior evidence was
incomplete. Run cleanup only when a concrete named finding exists in changed
files; any cleanup edit invalidates affected verification and review.

Acceptance evidence is a binding stop condition. Once the requested behavior,
tests, and required review are green, stop. Do not make a post-green edit unless
a named unresolved finding remains; if one is necessary, rerun affected
verification and fresh review.

Receipts may record only profile, route, triggered skills, selected agents,
approval, command outcomes, and review verdict. Never record prompts, source
text, paths, provider metadata, raw output, or secrets.

## Next gate

Return an outcome-first acceptance report with the implemented result, fresh
evidence, remaining limitation, and the explicit stop condition. A review
returns `ship`, `fix-first`, or `rethink`; it never implies merge, deployment,
or external-write approval.
