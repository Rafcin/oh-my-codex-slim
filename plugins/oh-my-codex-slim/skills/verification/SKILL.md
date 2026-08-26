---
name: verification
description: Prove a completed change against explicit acceptance criteria before claiming completion, release readiness, or runtime success.
---

# Verification

Verification is fresh evidence, not confidence.

## Entry conditions

Use after the final implementation or cleanup change and before claiming completion. Translate the request and plan into an acceptance matrix. For each criterion, identify the observable boundary and strongest safe check: focused tests, type and lint gates, fixtures, validators, isolated installation, or a real runtime check.

## Scope limit

Run commands after the final change and record their exit status and meaningful result. Distinguish evidence levels:

- source verification proves local code and static contracts;
- isolated local verification proves packaged or installed behavior in a fixture;
- discovery proof shows a host can see a plugin, skill, agent, or tool;
- runtime proof exercises the real behavior;
- external-environment proof confirms deployed or service state.

Do not promote one level into another. A discovery listing does not prove execution, and a fixture does not prove a live service. Keep secrets out of evidence. Any quota-consuming real-model check needs explicit approval.

## Exit evidence

Report exact commands, criteria, outcomes, warnings, skipped approval-gated checks, and remaining gap. Never claim completion from stale output or a test that missed the acceptance boundary.

## Next gate

Use fresh `code-review` if the OMCS route requires it; otherwise return the acceptance matrix to OMCS. Any later edit invalidates this evidence and restarts verification.
