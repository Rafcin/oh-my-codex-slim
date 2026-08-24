---
name: tdd
description: Implement a feature or bug fix test-first when the user asks for red-green development or the change needs a regression seam.
---

# Test-Driven Development

Work in small vertical slices through a public behavior seam.

Before production code, write one focused test whose expected value comes from the requirement, a known-good example, or a reproduced bug. Name the production change that would make the test fail. Run it and confirm the failure is caused by the missing behavior, not a typo, import error, or unrelated broken baseline.

Implement only enough code to make that test pass. Rerun the focused test and relevant neighboring tests. Refactor only while green, preserving the public behavior. Then start the next slice with a new failing test.

Prefer tests that survive internal refactoring. Avoid assertions against private helpers, duplicated implementation logic in expected values, broad snapshots without a stable contract, and mocks of collaborators you own. Use a fake only at a genuine external boundary and preserve the dependency's important behavior.

For a bug, first reproduce the exact symptom and convert the minimized case into the regression test. For configuration or generated artifacts, validate the observable consumer contract rather than wording alone.

Completion requires recorded red evidence, green evidence, focused and baseline checks, and a clean diff with no speculative behavior added beyond the tested requirement.
