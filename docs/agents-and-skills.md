# OMCS agents and skills

OMCS keeps the team small and the accountability clear. The architect is the primary task: worker reports help, but only inspected change and fresh verification satisfy acceptance.

## Native roles

| Role | Default lane | Responsibility |
| --- | --- | --- |
| `omcs_architect` | Sol / High | Intent, architecture, routing, decomposition, parent verification, and acceptance. |
| `omcs_explorer` | Luna / Low | Fast read-only repository and symbol map. |
| `omcs_librarian` | Luna / Medium | Read-only primary-source and dependency research. |
| `omcs_oracle` | Sol / High | Read-only difficult diagnosis and architecture advice. |
| `omcs_fixer` | Luna / Max | Routine, fully specified implementation. |
| `omcs_terra_fixer` | Terra / High | Judgment-heavy or wider-blast-radius implementation. |
| `omcs_designer` | Terra / High | User-facing design, implementation, and visual proof. |
| `omcs_reviewer` | Sol / High | Fresh read-only specification and quality review. |

Two write-capable agents never own overlapping files. Default parallelism is two, and configuration or available slots may reduce it. Every implementation packet states an observable objective, exact file ownership, interfaces and compatibility, constraints and exclusions, verification commands, and a structured return contract. It also warns that the user or another lane may be editing concurrently and forbids reverting unrelated work.

## Skill catalog

| Skill | OMCS use |
| --- | --- |
| `omcs` | Primary entrypoint and risk-gated route composition. |
| `context` | Resolve material ambiguity and project language with one focused question at a time. |
| `codebase-design` | Choose interfaces and seams; favor deep modules and public-interface tests. |
| `research` | Use current primary sources and separate evidence from inference. |
| `plan` | Specify files, interfaces, tests, and ownership for multi-step or risky work. |
| `tdd` | Use red-green vertical slices at agreed seams. |
| `implement` | Execute an approved plan through the selected route. |
| `ai-slop-cleaner` | Inspect changed files for concrete generated noise, duplication, dead paths, or speculative abstraction. |
| `simplify` | Reduce correct changed code without changing behavior. |
| `verification` | Produce fresh evidence for acceptance criteria. |
| `code-review` | Run fresh specification and quality review when required. |
| `codemap` | Build or refresh bounded repository context. |
| `diagnose` | Investigate a reproducible defect before editing. |
| `deepwork` | Execute settled work with ownership and verification discipline. |
| `deep-interview` | Clarify an underspecified problem. |
| `omcs-orchestrate` | Compatibility alias that directs to `omcs`; it does not duplicate the workflow. |

Focused skills remain available directly, but a normal run needs only “use OMCS.” OMCS selects the gates rather than asking users to assemble a ceremony.

## Fresh review

The reviewer returns `ship`, `fix-first`, or `rethink` after reading the accumulated change against the approved design and repository standards. The reviewer is a fresh, read-only lane. Any correction invalidates the verdict: the architect inspects the correction, reruns relevant verification, and obtains a new fresh review for an `audit` or `full` route.

Read [execution modes](execution-modes.md) for route choice and [examples](examples.md) for concrete flows.
