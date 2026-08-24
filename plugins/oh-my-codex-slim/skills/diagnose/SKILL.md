---
name: diagnose
description: Diagnose a reproducible bug or performance regression by building a tight feedback loop and testing ranked hypotheses before proposing a fix.
---

# Diagnose

Diagnosis determines cause and evidence. Do not implement a fix unless the user's request includes fixing the issue.

First build the narrowest red-capable feedback loop that reproduces the reported symptom: a focused test, CLI fixture, request replay, browser assertion, trace, or measurement harness. Redact secrets from commands, output, and captured artifacts. Tighten the loop until it is deterministic enough, fast enough, and specific to the user's failure.

Reproduce the issue and minimize the case while preserving the failure. Then list several ranked, falsifiable hypotheses. For each one, state the observation that would support or reject it. Probe one variable at a time using a debugger, targeted instrumentation, `omcs_diagnostics`, `omcs_symbols`, or `omcs_references` when those tools are available. Do not fetch missing tooling automatically.

For performance work, establish a repeatable baseline before changing code. For intermittent failures, improve the reproduction rate and record the seed, timing, or load conditions.

Report the confirmed cause, ruled-out hypotheses, exact reproduction command, evidence, and remaining uncertainty. If a fix was also requested, convert the minimized case into a regression test, observe it fail, apply the smallest correction, rerun the original loop, and remove temporary instrumentation before completion.
