---
name: deepwork
description: Execute an already-approved, multi-step implementation plan with sustained focus, explicit ownership, and continuous verification.
---

# Deepwork

Use this skill only when an implementation plan is already approved and the user asked for end-to-end execution. The plan and its referenced specification are authoritative.

Before editing, confirm the repository state, applicable instructions, owned paths, and the first incomplete task. Maintain a durable progress record when execution spans many tasks. Do not reset, stash, or overwrite unrelated work.

Execute one task at a time using test-driven vertical slices: write the behavior test, observe the expected failure, implement the smallest passing change, then refactor while green. Run focused checks after each slice and the task's baseline checks before its commit. Keep commits narrow and attributable.

Use OMCS routing only when the risk policy calls for it. Delegated work receives explicit objective, ownership, context, constraints, and evidence requirements. Verify worker claims from the actual diff and fresh commands. A review finding that changes implementation invalidates the earlier verdict and requires fresh verification.

Continue through safe in-scope work without status prompts. Stop only for a genuinely destructive or irreversible action, security-sensitive authorization, an external side effect that requires confirmation, or a plan defect with no grounded path forward. Report the exact verification stage and any approval-gated proof still outstanding.

For an explicitly isolated or parallel Git lane, read [Worktree lanes](references/worktrees.md) before creating, integrating, or removing a worktree.
