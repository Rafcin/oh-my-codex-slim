---
name: omcs
description: Use when a substantial engineering task needs OMCS risk-gated orchestration, including when the user says use OMCS to solve this issue.
---

# OMCS

OMCS owns one composed, evidence-led delivery run. It routes focused skills and native agents; it does not turn a review into approval or an external boundary into an implied write.

## Entry conditions

Resolve configuration as session override → nearest `omcs.config.json` → global preferences → safe defaults. Inspect the task, ownership, and risk, then declare before task tools:

```text
OMCS ROUTE
profile: auto | fast | thorough | council
mode: solo | delegate | audit | full
risk: <task-specific rationale>
skills: <selected skills>
agents: <architect and selected agents>
approval: <policy>
```

`council` is explicit-only and advisory. `auto`, `fast`, and `thorough` select a delivery route, never council. An observed risk may escalate a route; it never silently downgrades it.

## Scope limit

Pause for a material decision: user-visible scope, persistent contract, public compatibility, security or credential ownership, architecture, dependency, or irreversible external state. Otherwise select only needed gates: `context`, exploration/research, `codebase-design`, `plan`, `tdd`, `implement`, changed-file anti-slop, `verification`, and risk-gated `code-review`.

Delegate one write scope per agent. Every packet states objective, exact owned files, interfaces, exclusions, verification evidence, and concurrent-work preservation. Use the declared native role; unavailable role/model evidence fails that lane closed. OpenCodex owns external transport and credentials.

## Exit evidence

Inspect the accumulated diff and fresh commands yourself. Before final review, automatically require anti-slop for `thorough`, `audit`, and `full`, and whenever concrete smells appear; it may edit only changed-file scope. A correction or later edit invalidates verification and any review verdict; rerun both as applicable. Receipt: profile, route, skills, agents, approval, command outcomes, and review verdict—never timestamps, prompts, paths, tool summaries, or secrets.

## Next gate

Return evidence-backed acceptance only after `verification`; use fresh `code-review` when the declared route requires it. Review returns `ship`, `fix-first`, or `rethink`, never merge or deployment approval.
