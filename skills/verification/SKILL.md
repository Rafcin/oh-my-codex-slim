---
name: verification
description: Prove a completed change against explicit acceptance criteria before claiming completion, release readiness, or runtime success.
---

# Verification

Verification is fresh evidence, not confidence. Translate the request and plan into an acceptance matrix before choosing commands.

For each criterion, identify the observable boundary and the strongest safe check available: focused unit or integration tests, type and lint gates, fixture-driven protocol checks, package or manifest validators, isolated installer fixtures, or a real runtime check. Run commands after the final change and record their exit status and meaningful result.

Distinguish evidence levels explicitly:

- source verification proves local code and static contracts;
- isolated local verification proves packaged or installed behavior in a fixture;
- discovery proof shows a host can see a plugin, skill, agent, or tool;
- runtime proof exercises the real behavior;
- external-environment proof confirms deployed or service state.

Do not promote one level into another. A discovery listing does not prove execution, and a fixture does not prove a live service. Keep secret values out of logs and reports. Any quota-consuming real-model check requires explicit approval for that specific test.

Report the exact commands, passing criteria, failures or warnings, skipped approval-gated checks, and remaining gap. Never claim completion from stale output or from a test that did not exercise the acceptance boundary.
