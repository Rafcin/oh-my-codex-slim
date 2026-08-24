---
name: deep-interview
description: Clarify an underspecified product or engineering request through one focused question at a time before planning or implementation.
---

# Deep Interview

Use this workflow when the outcome, boundaries, or acceptance criteria are genuinely unclear. Skip it when the request is already execution-ready or the user explicitly asks to proceed with stated assumptions.

Inspect discoverable facts first: governing instructions, nearby documentation, current behavior, relevant code, and existing plans. Do not ask the user to supply repository facts you can establish safely. If sources conflict, present the conflict precisely and ask which behavior should govern.

Ask one high-leverage question at a time. Resolve intent and desired outcome before implementation detail, then scope, non-goals, constraints, success criteria, and decisions that still require user approval. Pressure-test vague answers with a concrete example, counterexample, hidden assumption, or tradeoff. Do not continue merely to reach a fixed number of rounds.

When the request is ready, summarize:

- the problem and observable outcome;
- in-scope behavior and explicit non-goals;
- acceptance criteria;
- constraints and supporting evidence;
- what Codex may decide and what still requires confirmation;
- relevant technical context without prematurely choosing an implementation.

End at the handoff boundary. Offer planning or execution only after the user accepts the clarified intent; do not silently begin either inside the interview.
