---
name: deepwork
description: Execute an already-approved, multi-step implementation plan with sustained focus, explicit ownership, and continuous verification.
---

# Deepwork

## Entry conditions

Use only for an approved multi-step plan that the user asks to execute end-to-end. The plan and specification are authoritative. Confirm repository state, instructions, owned paths, and the first incomplete task; maintain a durable progress record for long work.

## Scope limit

Execute one task at a time with test-driven vertical slices and narrow attributable commits. Do not reset, stash, overwrite unrelated work, or widen a task because it is nearby. Delegate only under the declared OMCS route with exclusive write ownership.

Verify worker claims from the actual diff and fresh commands. A correction invalidates earlier verification and review.

## Exit evidence

Report completed plan steps, owned changes, focused and baseline evidence, current verification stage, and approval-gated proof still outstanding. Stop only for destructive or irreversible action, security-sensitive authorization, required external confirmation, or a plan defect with no grounded path.

For an explicitly isolated or parallel Git lane, read [Worktree lanes](references/worktrees.md) before creating, integrating, or removing a worktree.

## Next gate

Run `verification`, then the route-required fresh `code-review`; return a material plan defect to `context` or `plan`.
