---
name: omcs
description: Use when a substantial engineering task needs OMCS risk-gated orchestration, including when the user says use OMCS to solve this issue.
---

# OMCS

OMCS owns one composed, evidence-led delivery run. It routes focused skills and native agents; it does not turn a review into approval or an external boundary into an implied write.

## Entry conditions

Before the route declaration, run `omcs config show --effective --json` in the task working directory. This read-only command is the only pre-route task-tool exception. Bind its returned profile and source identity to this run. A session override exists only in current-request/in-memory context: overlay it after the command only when the user explicitly names `auto`, `fast`, `thorough`, or `council`; never claim it persisted or call `configure --scope session` to persist it. Natural-language urgency such as “move fast” is not a `fast` override.

Classify settled/unsettled, blast radius (`narrow`, `moderate`, `wide`), review-required, visual, delegable, research, reproduction, generated-code, repository-mapping, difficult-diagnosis, and architecture-advice signals. Then apply this kernel exactly:

- Unsettled or non-delegable → `audit` with `omcs_reviewer` when review is required, otherwise `solo`.
- Settled and delegable → `full` when review is required, otherwise `delegate`; use `omcs_designer` for visual work, `omcs_terra_fixer` for wide blast radius, otherwise `omcs_fixer`.
- `thorough` and `council` force review. Add `context`, `codebase-design`, `plan`, and `tdd` for either profile; otherwise add them from uncertainty/blast/reproduction. Add `research` only when needed, `verification` always, anti-slop for thorough/council/audit/full/generated-code, and `code-review` for thorough/council/audit/full.
- Always declare `omcs_architect`; add `omcs_explorer` for repository mapping, `omcs_librarian` for research, and `omcs_oracle` for difficult diagnosis or architecture advice. Add the route implementer/reviewer above.

Inspect the task, ownership, and risk, then declare before any other task tool:

```text
OMCS ROUTE
profile: auto | fast | thorough | council
mode: solo | delegate | audit | full
risk: <task-specific rationale>
skills: <selected skills>
agents: <architect and selected agents>
approval: <policy>
```

`council` is explicit-only and advisory. It requires at least two proven distinct native lanes or fails closed without substituting hidden diversity. `auto`, `fast`, and `thorough` never activate council. An observed risk may escalate a route; it never silently downgrades it.

## Scope limit

Pause for a material decision: user-visible scope, persistent contract, public compatibility, security or credential ownership, architecture, dependency, or irreversible external state. Otherwise select only needed gates: `context`, exploration/research, `codebase-design`, `plan`, `tdd`, `implement`, changed-file anti-slop, `verification`, and risk-gated `code-review`.

Delegate one write scope per agent. Every packet states objective, exact owned files, interfaces, exclusions, verification evidence, and concurrent-work preservation. Use the declared native role; unavailable role/model evidence fails that lane closed. OpenCodex owns external transport and credentials.

## Exit evidence

Inspect the accumulated diff and fresh commands yourself. Before final review, automatically require anti-slop for `thorough`, `audit`, and `full`, and whenever concrete smells appear; it may edit only changed-file scope. A correction or later edit invalidates verification and any review verdict; rerun both as applicable. Receipt: profile, route, skills, agents, approval, command outcomes, and review verdict—never timestamps, prompts, paths, tool summaries, or secrets.

## Next gate

Return evidence-backed acceptance only after `verification`; use fresh `code-review` when the declared route requires it. Review returns `ship`, `fix-first`, or `rethink`, never merge or deployment approval.
