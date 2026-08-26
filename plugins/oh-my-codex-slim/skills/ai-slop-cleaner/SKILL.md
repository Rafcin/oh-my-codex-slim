---
name: ai-slop-cleaner
description: Use when an OMCS thorough, audit, or full route reaches pre-review changed-file inspection, or the user explicitly identifies AI-generated or slop code.
---

# AI Slop Cleaner

Generic behavior-preserving simplification belongs to `simplify`. This is automatically required before review for OMCS `thorough`, `audit`, and `full` routes, and a focused response to a user-identified generated-code smell.

## Entry conditions

Start from the accumulated changed-file scope and name the concrete smell: dead code, duplicate branches, pass-through wrappers, speculative abstraction, swallowed errors, silent defaults, misleading comments, or implementation-coupled tests. Identify the observable behavior to preserve and its narrowest behavior lock.

## Scope limit

Edits stay inside changed-file scope and remove a named smell; this is not permission for a broad rewrite, new dependency, or redesign. A masking fallback hides contract failure or suppresses evidence; repair its cause or fail explicitly. Preserve a compatibility or safety boundary with a documented reason and coverage for both paths.

Work deletion-first, one smell class at a time. Rerun the behavior lock and inspect the diff after each coherent pass.

## Exit evidence

Report changed files, each removed smell, preserved fallback rationale, focused checks, and semantic-risk gap. Cleanup completes only when the focused behavior remains green and no unrelated edit or temporary artifact remains.

## Next gate

Run `verification` after any cleanup edit. Fresh `code-review` follows only after that evidence, because cleanup invalidates an earlier review.
