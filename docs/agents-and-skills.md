# OMCS agents and skills

OMCS keeps accountability in the primary task. An auxiliary is useful only when
it replaces work the primary context would otherwise perform or provides
required independent scrutiny.

## Native roles

| Role | Default lane | Responsibility |
| --- | --- | --- |
| `omcs_architect` | Sol / High | Intent, routing, architecture, integration, fresh verification, acceptance, and the stop decision. |
| `omcs_explorer` | Luna / Low | Smallest relevant read-only repository and symbol map. |
| `omcs_librarian` | Luna / Medium | Read-only primary-source and dependency research. |
| `omcs_oracle` | Sol / High | Read-only difficult diagnosis and architecture advice. |
| `omcs_fixer` | Luna / Max | Routine, fully specified implementation. |
| `omcs_terra_fixer` | Terra / High | Judgment-heavy or wider-blast implementation. |
| `omcs_designer` | Terra / High | Bounded user-facing design, implementation, and visual proof. |
| `omcs_reviewer` | Sol / High | Fresh read-only specification and quality review. |

`auto` and `fast` use at most one auxiliary. `thorough` may use one implementer
plus one reviewer. Two writers never receive overlapping files. Every packet
states objective, exact ownership, interfaces, exclusions, required evidence,
and concurrent-work preservation.

The packet substitutes for primary-context work. The architect does not remap
the same repository, redo the same research, or reimplement the same scope. It
inspects the actual result and fresh acceptance evidence before completion.

## Progressive skill catalog

Skills are loaded by a named trigger, not as a universal pipeline:

| Trigger | Skill or role |
| --- | --- |
| Material ambiguity | `context` or `deep-interview` |
| Repository-mapping bottleneck | `codemap` or Explorer |
| Current external behavior | `research` or Librarian |
| Difficult reproducible defect | `diagnose` or Oracle |
| Material interface or architecture decision | `codebase-design` |
| Multi-step, delegated, persistent, or risky work | `plan` |
| Observable behavior change or regression | `tdd` |
| Bounded approved implementation | `implement` or `deepwork` |
| Concrete named changed-file smell | `ai-slop-cleaner` |
| Justified behavior-preserving reduction | `simplify` |
| Final acceptance proof | `verification` |
| Route requires independent review | `code-review` |

`omcs` is the primary entrypoint. `omcs-orchestrate` remains a compatibility
alias and does not duplicate the workflow.

## Finding-triggered cleanup

Anti-slop is not a separate no-op phase. It runs only when a concrete named
finding identifies dead paths, duplication, pass-through abstraction, masking
fallbacks, misleading comments, or implementation-coupled tests inside the
accumulated changed-file scope. No finding means no cleanup edit. Any edit
invalidates affected verification and review.

## Fresh review and stop

The Reviewer returns `ship`, `fix-first`, or `rethink` after reading the actual
change against requirements and repository standards. It does not edit. A
correction invalidates the verdict and requires fresh verification plus another
review when the route requires one.

Once the behavior, tests, and required review are green, acceptance evidence is
a binding stop condition. OMCS makes no post-green edit without a named
unresolved finding.

Read [execution modes](execution-modes.md) for route choice and
[examples](examples.md) for concrete flows.
