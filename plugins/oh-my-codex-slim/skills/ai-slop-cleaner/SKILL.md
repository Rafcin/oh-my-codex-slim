---
name: ai-slop-cleaner
description: Use only for an explicit concrete changed-file finding of AI-generated or slop noise when behavior must be preserved.
---

# AI Slop Cleaner

Generic behavior-preserving simplification belongs to `simplify`. Use this
skill only when a concrete finding identifies generated noise, duplication,
dead paths, masking fallbacks, or speculative abstraction in changed files.

## Entry conditions

Start from the accumulated changed-file scope and name the exact smell: dead
code, duplicate branches, pass-through wrappers, speculative abstraction,
swallowed errors, silent defaults, misleading comments, or
implementation-coupled tests. Identify the observable behavior to preserve and
its narrowest behavior lock.

## Scope limit

Edits stay inside changed-file scope and remove the named smell; this is not
permission for a broad rewrite, new dependency, or redesign. A masking fallback
hides contract failure or suppresses evidence; repair its cause or fail
explicitly. Preserve a compatibility or safety boundary only with a documented
reason and coverage for both paths.

Work deletion-first, one smell class at a time. Rerun the behavior lock and
inspect the diff after each coherent pass. If the named finding is absent, make
no edit and stop this skill.

## Exit evidence

Report changed files, each removed smell, preserved fallback rationale, focused
checks, and semantic-risk gap. Cleanup completes only when the focused behavior
remains green and no unrelated edit or temporary artifact remains.

## Next gate

Run `verification` after any cleanup edit. Fresh `code-review` follows only
after that evidence because cleanup invalidates an earlier review.
