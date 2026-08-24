---
name: code-review
description: Review a completed code change against its stated requirements and repository standards without implementing fixes.
---

# Code Review

Review the requested change as a read-only task. Do not implement fixes unless the user separately asks for them.

Establish the review scope from the user's request, the governing repository instructions, and the actual accumulated diff. Read relevant tests and callers rather than judging changed lines in isolation. Treat implementation reports and prior test summaries as claims; run safe focused checks when they materially affect the verdict.

Review on two separate axes:

- Specification: missing requirements, unintended behavior, and code that appears to satisfy the request but does so incorrectly.
- Quality: correctness, security, data safety, concurrency, error behavior, compatibility, maintainability, and meaningful test coverage.

Report only actionable findings. Rank them as Critical, Important, or Minor; include a precise file and line, the failing scenario, why it matters, and the smallest credible correction. Do not inflate style preferences into defects, and do not speculate without a concrete execution path.

End with explicit specification and quality verdicts. If no actionable finding remains, say so and identify any verification boundary that was not exercised.
