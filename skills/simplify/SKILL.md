---
name: simplify
description: Reduce accidental complexity in working code when behavior must remain unchanged and the user wants a smaller, clearer implementation.
---

# Simplify

## Entry conditions

Use for a requested behavior-preserving simplification after behavior is understood. Establish a behavior lock and inspect real callers. Identify the smallest accidental complexity: duplication, indirection, fragmented flow, broad types, speculative configuration, or an obscuring abstraction.

## Scope limit

Prefer deletion, direct data flow, existing language features, and local names. Keep a boundary that protects ownership, side effects, compatibility, or testing. Do not collapse layers merely to reduce lines, add a dependency for a local cleanup, or broaden into architecture work.

Make one coherent change at a time and rerun the behavior lock, relevant static gates, and baseline tests.

## Exit evidence

Report what became simpler, preserved boundaries, commands, and any risk that prevented further reduction.

## Next gate

Return to `verification`; use `codebase-design` instead when the requested simplification changes a seam or interface.
