---
name: diagnose
description: Diagnose a reproducible bug or performance regression by building a tight feedback loop and testing ranked hypotheses before proposing a fix.
---

# Diagnose

Diagnosis determines cause and evidence.

## Entry conditions

Use for a reproducible defect or performance regression. Build the narrowest red-capable loop: focused test, fixture, replay, browser assertion, trace, or measurement. Redact secrets and tighten it until it is specific and repeatable.

## Scope limit

Minimize the failure, rank falsifiable hypotheses, and probe one variable at a time. Establish a performance baseline or intermittent reproduction conditions before changing code. Do not implement a fix unless requested or fetch missing tooling automatically.

## Exit evidence

Report confirmed cause, ruled-out hypotheses, exact reproduction, evidence, and remaining uncertainty. If fixing was requested, preserve the minimized case as a regression seam and remove temporary instrumentation.

## Next gate

Hand a confirmed fix seam to `tdd` and `implement`; return an unresolved material behavior choice to `context`.
