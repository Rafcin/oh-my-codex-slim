# Worktree lanes

Use a worktree when the user requests isolation or when an approved plan assigns independent, non-overlapping implementation ownership. Do not create one for a small edit that is already safe in the current checkout.

Preflight the repository root, current branch, dirty state, `git worktree list`, branch-name availability, target path, and ignore rules. Keep OMCS lanes beneath `.omcs/worktrees/<slug>/`. Creating or integrating a lane must already be in task scope; branch deletion, dirty-lane removal, force operations, or pruning require explicit authorization for the exact action.

Give each lane one owner and a disjoint file boundary. Run its edits, tests, and commits from that worktree, then inspect the accumulated diff against the recorded base. Verify the final state before any approved merge or cherry-pick.

Before cleanup, prove the lane is clean and its work is integrated or deliberately preserved. Remove only the exact registered worktree path, update local lane metadata, and leave unrelated branches, worktrees, and uncommitted changes untouched.
