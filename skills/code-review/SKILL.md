---
name: code-review
description: Review a completed code change against its stated requirements and repository standards without implementing fixes.
---

# Code Review

Review the requested change as a fresh, read-only task. Do not implement fixes unless the user separately asks for them.

## Entry conditions

Establish review scope from the request, governing instructions, final accumulated diff, and accepted specification. Read relevant tests and callers rather than judging changed lines in isolation. Treat reports and prior test summaries as claims; a post-review correction or formatting change invalidates the verdict.

## Scope limit

Review two axes without patching:

- Specification: missing requirements, unintended behavior, and code that appears to satisfy the request but does so incorrectly.
- Quality: correctness, security, data safety, concurrency, error behavior, compatibility, maintainability, and meaningful test coverage.

Report only actionable findings. Rank them as Critical, Important, or Minor; include a precise file and line, failing scenario, impact, and smallest credible correction. Do not inflate style preferences into defects or speculate without a concrete execution path.

## Exit evidence

End with specification and quality verdicts plus `ship`, `fix-first`, or `rethink`. Identify every unexercised verification boundary. A verdict is evidence, never merge, deployment, or approval authority.

## Next gate

`fix-first` or `rethink` returns to the owning implementer, then requires fresh `verification` and a new review. `ship` proceeds to the OMCS acceptance boundary.
