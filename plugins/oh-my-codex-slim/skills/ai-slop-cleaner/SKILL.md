---
name: ai-slop-cleaner
description: Clean a bounded scope only when the user explicitly identifies AI-generated, slop, or noisy-generated code patterns.
---

# AI Slop Cleaner

Use this only when the user explicitly asks to clean AI-generated code, slop, or noisy generated patterns. Generic behavior-preserving simplification belongs to `simplify`. Keep the cleanup bounded to the files or feature the user placed in scope; do not use it to redesign a system or add new behavior.

Before editing, identify the observable behavior that must remain unchanged and run the narrowest useful tests. Inventory the actual smells in scope: dead code, duplicate branches, pass-through wrappers, speculative abstraction, swallowed errors, silent defaults, misleading comments, and tests coupled to implementation details.

Classify fallback-like code before removing it. A masking fallback hides contract failure or suppresses evidence; prefer root-cause repair or explicit failure. A legitimate compatibility or safety boundary has a documented reason and tests for both the primary and fallback paths; preserve it unless the request changes that contract.

Work deletion-first and one smell class at a time. Reuse an existing utility only when it makes the result clearer. Do not introduce a new dependency or abstraction merely to make the diff look organized. After each coherent pass, rerun the behavior lock and inspect the diff for unintended semantic change.

Report the scope, removed complexity, tests and static checks run, any preserved fallback with its rationale, and remaining risk. A cleanup is complete only when the focused behavior remains green and no unrelated edits or temporary artifacts remain.
