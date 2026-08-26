---
name: omcs
description: Use when a substantial engineering task needs OMCS risk-gated orchestration, including when the user says use OMCS to solve this issue.
---

# OMCS

OMCS owns one composed, evidence-led delivery run. It routes focused skills and native agents; it does not turn a review into approval or an external boundary into an implied write.

## Entry conditions

Before the route declaration, run `omcs config show --effective --json` in the task working directory. This read-only command is the only pre-route task-tool exception. Bind its returned profile and source identity to this run. A session override exists only in current-request/in-memory context: overlay it after the command only when the user explicitly names `auto`, `fast`, `thorough`, or `council`; never claim it persisted or call `configure --scope session` to persist it. Natural-language urgency such as “move fast” is not a `fast` override.

Classify the policy inputs before routing:

- `settled` is true only when requirements, owned write scope, interfaces, and acceptance oracle are known. `delegable` is true only when one isolated packet can name those items without ownership conflict.
- Blast radius is `narrow` for one bounded internal surface, `moderate` for multiple internal surfaces or a persistent local contract, and `wide` for public compatibility, security/credential ownership, dependencies/architecture, irreversible state, or external state.
- `reviewRequired` is true for user-visible behavior, public APIs/compatibility, security/credentials, dependencies/architecture, or persistent, irreversible, or external state. Set `visual`, `needsResearch`, `hasReproduction`, `generatedCodeRisk`, `needsRepositoryMapping`, `needsDifficultDiagnosis`, and `needsArchitectureAdvice` only from direct task evidence.

Apply this kernel exactly:

- Set `review` true when the profile is `thorough` or `council`, or `reviewRequired` is true.
- If not settled or not delegable, choose `audit` plus `omcs_reviewer` when `review` is true; otherwise choose `solo`.
- Otherwise choose the implementer in this precedence: visual → `omcs_designer`; non-visual `wide` → `omcs_terra_fixer`; all other work → `omcs_fixer`. Choose `full` plus `omcs_reviewer` when `review` is true; otherwise choose `delegate`.
- Skills: add `context` for thorough/council or unsettled; `codebase-design` and `plan` for thorough/council, unsettled, or non-narrow blast; `research` only for `needsResearch`; `tdd` for thorough/council, unsettled, or `hasReproduction`; `ai-slop-cleaner` for thorough/council, audit/full, or `generatedCodeRisk`; `verification` always; `code-review` for thorough/council or audit/full.
- Always declare `omcs_architect`; add `omcs_explorer` for `needsRepositoryMapping`, `omcs_librarian` for `needsResearch`, and `omcs_oracle` for `needsDifficultDiagnosis` or `needsArchitectureAdvice`. Add exactly the implementer/reviewer selected above.

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
