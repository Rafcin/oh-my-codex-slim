---
name: codemap
description: Build or refresh a concise repository map when a codebase's modules, entry points, and dependency boundaries must be understood.
---

# Codemap

Produce a factual, compact map of the repository without changing source files unless the user explicitly asks to save the result.

Start with governing instructions and top-level manifests. Use `rg --files` to inventory the tree and `rg` to trace entry points, imports, commands, configuration, tests, and generated boundaries. When available, use `omcs_symbols` and `omcs_references` to confirm symbol relationships; treat an unavailable language server as a limitation, not a reason to fetch one.

Follow only the paths needed for the user's question. Distinguish authored source, generated output, fixtures, vendored code, and runtime state. Confirm important flows from actual imports or call sites rather than directory names alone.

Report:

- primary entry points and commands;
- module ownership and responsibilities;
- key data or control flows;
- external boundaries and configuration inputs;
- relevant tests and verification commands;
- unresolved or inferred relationships, labeled clearly.

Keep the map skimmable and link each conclusion to concrete repository paths. Do not turn the map into an architecture proposal unless the user also asked for redesign advice.

When documentation is insufficient and the user needs dependency implementation source, read [Clone dependency source](references/clone-dependency.md) before using the OMCS clone tool.
