---
name: codemap
description: Build or refresh a concise repository map when a codebase's modules, entry points, and dependency boundaries must be understood.
---

# Codemap

## Entry conditions

Use when modules, entry points, or dependency boundaries must be understood. Produce a factual compact map without source edits unless asked to save it. Start with instructions and top-level manifests; use `rg --files` and `rg` to trace entry points, imports, commands, configuration, tests, and generated boundaries.

## Scope limit

Follow only paths needed for the question. Distinguish authored source, generated output, fixtures, vendored code, and runtime state. Confirm flows from imports or call sites, not directory names. Treat unavailable symbol tooling as a limitation, not a reason to fetch it.

## Exit evidence

Report:

- primary entry points and commands;
- module ownership and responsibilities;
- key data or control flows;
- external boundaries and configuration inputs;
- relevant tests and verification commands;
- unresolved or inferred relationships, labeled clearly.

Keep the map skimmable and link conclusions to paths. Do not turn it into an architecture proposal.

When documentation is insufficient and the user needs dependency implementation source, read [Clone dependency source](references/clone-dependency.md) before using the OMCS clone tool.

## Next gate

Hand an ambiguity to `context`, a seam decision to `codebase-design`, or a reproducible defect to `diagnose`.
