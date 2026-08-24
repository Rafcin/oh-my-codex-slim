---
name: plan
description: Turn settled requirements into an implementation plan with exact files, interfaces, tests, verification, and safe commit boundaries.
---

# Plan

Use this skill after requirements are settled. If a business decision or acceptance criterion is still material and unresolved, return to clarification rather than hiding it in an assumption.

Inspect the repository before proposing changes: governing instructions, current architecture, relevant callers, tests, configuration ownership, and the working-tree state. Preserve unrelated or concurrent edits. Prefer the smallest design that satisfies the accepted outcome.

Write an executable plan whose tasks are coherent vertical slices. Each task should name:

- exact files to create, modify, or remove;
- public interfaces and data contracts;
- a failing behavior test to write first and its expected failure;
- the minimal implementation needed to make it pass;
- focused and baseline verification commands;
- ownership, rollback, security, or migration constraints;
- a focused commit boundary.

Call out dependencies between tasks, irreversible or external effects, secrets boundaries, and any verification that needs explicit user approval. Use pinned versions or exact upstream revisions when reproducibility matters. Separate source checks, local runtime proof, and external-environment proof so the implementer cannot accidentally overstate completion.

End with measurable acceptance criteria and a completion checklist. Do not begin implementation unless the user requested execution as part of the same task.
