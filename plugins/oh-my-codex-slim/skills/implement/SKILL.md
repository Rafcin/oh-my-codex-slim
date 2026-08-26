---
name: implement
description: Use when a bounded implementation task has settled requirements, declared ownership, and a credible behavior seam.
---

# Implement

Execute the declared route through small, evidence-producing vertical slices.

## Entry conditions

Confirm the accepted requirement or plan, owned paths, public seam, working-tree boundary, and required verification. For delegated work, accept only a packet with objective, ownership, interfaces, exclusions, and evidence expectations.

## Scope limit

Write only owned files. Preserve concurrent changes, do not add speculative behavior, and do not make a reviewer repair its own finding. Use `tdd` for behavior changes; stop at a material decision or an ownership conflict instead of guessing.

## Exit evidence

Report changed paths, the behavior exercised, red and green evidence where applicable, focused commands and outcomes, remaining gaps, and any out-of-scope observation. The parent verifies from the diff and fresh commands rather than this report alone.

## Next gate

Run `ai-slop-cleaner` when the route requires it or concrete generated noise appears, then `verification`; a declared review route ends with fresh `code-review`.
