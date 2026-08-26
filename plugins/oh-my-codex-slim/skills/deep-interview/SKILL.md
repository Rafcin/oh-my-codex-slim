---
name: deep-interview
description: Clarify an underspecified product or engineering request through one focused question at a time before planning or implementation.
---

# Deep Interview

## Entry conditions

Use only when outcome, boundaries, or acceptance criteria are genuinely unclear. Skip execution-ready work or an explicit request to proceed with stated assumptions. Inspect discoverable facts first and do not ask the user for repository facts that can be established safely.

## Scope limit

Ask one high-leverage question at a time: outcome before implementation detail, then scope, exclusions, constraints, success criteria, and approval decisions. If sources conflict, state the conflict precisely. Do not continue to reach a fixed round count or begin planning or implementation inside this interview.

## Exit evidence

When ready, summarize:

- the problem and observable outcome;
- in-scope behavior and explicit non-goals;
- acceptance criteria;
- constraints and supporting evidence;
- what Codex may decide and what still requires confirmation;
- relevant technical context without prematurely choosing an implementation.

End at the handoff boundary.

## Next gate

After clarified intent is accepted, use `context` for a durable constraint, `codebase-design` for a seam decision, or `plan` for execution planning.
