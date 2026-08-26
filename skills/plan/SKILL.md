---
name: plan
description: Turn settled requirements into an implementation plan with exact files, interfaces, tests, verification, and safe commit boundaries.
---

# Plan

## Entry conditions

Use after requirements are settled for multi-step, delegated, persistent, or risky work. If a business decision or acceptance criterion is still material and unresolved, return to `context` rather than hiding it in an assumption. Inspect instructions, architecture, callers, tests, configuration ownership, and the working tree.

## Scope limit

Write only the smallest executable plan for the accepted outcome. Preserve concurrent edits; do not use planning to make a material architecture or compatibility decision that belongs in `codebase-design` or needs approval. Each coherent vertical slice names:

- exact files to create, modify, or remove;
- public interfaces and data contracts;
- a failing behavior test to write first and its expected failure;
- the minimal implementation needed to make it pass;
- focused and baseline verification commands;
- ownership, rollback, security, or migration constraints;
- a focused commit boundary.

Call out dependencies, irreversible or external effects, secrets boundaries, and approval-gated verification. Separate source, local-runtime, and external-environment proof.

## Exit evidence

End with measurable acceptance criteria, ownership, an ordered task list, verification commands and expected results, and commit boundaries. The plan must make no unapproved external action look routine.

## Next gate

Hand a settled bounded slice to `tdd` and `implement`; retain it under `omcs` when it requires a declared agent packet or risk-gated review.
