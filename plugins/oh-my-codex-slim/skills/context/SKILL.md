---
name: context
description: Use when a material product or engineering decision remains unclear after repository evidence has been inspected.
---

# Context

Turn one unresolved decision into an agreed constraint, without interviewing for facts the repository already establishes.

## Entry conditions

Read governing instructions, nearby specifications, current behavior, and domain language first. Enter only when an outcome, boundary, acceptance condition, or term still has competing material meanings.

## Scope limit

Ask one focused question at a time. Do not use clarification to defer routine implementation choices, reopen settled decisions, or produce a generic questionnaire. Record a concise `CONTEXT.md` or ADR only when the decision will outlive this task and the repository has a fitting convention.

## Exit evidence

State the selected outcome, in-scope and excluded behavior, acceptance evidence, constraints, and the remaining approval owner. Name assumptions as assumptions; do not silently convert them into requirements.

## Next gate

Use `codebase-design` when the answer changes a module seam or contract; otherwise proceed to `plan`, `tdd`, or `implement` according to the declared OMCS route.
