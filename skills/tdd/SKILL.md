---
name: tdd
description: Implement a feature or bug fix test-first when the user asks for red-green development or the change needs a regression seam.
---

# Test-Driven Development

## Entry conditions

Use for an observable behavior change, regression, or approved behavior seam. Work in small vertical slices through the public seam. Before production code, write one focused test whose expected value comes from the requirement, known-good example, or reproduced bug. Confirm its red result is missing behavior, not a typo, import error, or unrelated baseline failure.

## Scope limit

Implement only enough to make that test pass, rerun focused and neighboring tests, and refactor only while green. Do not test private helpers, duplicate implementation logic in expected values, use broad snapshots without a stable contract, or add speculative behavior. A fake belongs only at a genuine external boundary.

For a bug, minimize the reported symptom into the regression test. For configuration or generated artifacts, test the observable consumer contract.

## Exit evidence

Record red evidence, green evidence, focused and baseline checks, and a clean diff with no behavior beyond the tested requirement.

## Next gate

Hand the completed slice to `implement` for its route-level report, then `verification`; use changed-file anti-slop before review when OMCS requires it.
