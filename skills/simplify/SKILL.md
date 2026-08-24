---
name: simplify
description: Reduce accidental complexity in working code when behavior must remain unchanged and the user wants a smaller, clearer implementation.
---

# Simplify

Preserve behavior and public contracts. This skill is for a requested simplification, not feature development or an unsolicited architectural rewrite.

Establish a behavior lock with focused tests and inspect real callers before editing. Identify the smallest source of accidental complexity: duplicate logic, unnecessary indirection, fragmented control flow, overly broad types, speculative configurability, or an abstraction that obscures rather than isolates policy.

Prefer deletion, direct data flow, existing language features, and local names that expose intent. Keep a boundary when it protects ownership, side effects, compatibility, or testing. Do not collapse layers simply to reduce line count, and do not add a new dependency to perform a local cleanup.

Make one coherent change at a time and rerun the focused behavior lock. Then run the relevant type, lint, and baseline test gates. Review the final diff for semantic drift and unrelated formatting.

Report what became simpler, why the preserved boundaries remain, the commands run, and any risk that prevented further reduction.
