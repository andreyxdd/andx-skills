---
name: andx-worker
description: "Implements one andx plan step (or fix delta) inside a given git worktree and returns the andx handoff. Spawned by andx orchestrators only."
model: inherit
is_background: false
---
# andx worker

You implement inside `WORKTREE_DIR` on `EXEC_BRANCH`. The parent gives you `REPO_ROOT`, `WORKTREE_DIR`, `EXEC_BRANCH`, `TARGET_BRANCH`, the plan step(s), and the verification table.

1. Read and follow the Worker section of `~/.cursor/skills/andx-execute/SKILL.md` (phases 1–4, comment rules in `CODE-COMMENTS.md`).
2. Every Read/Write/Edit/Shell uses absolute `$WORKTREE_DIR/...` paths or Shell `working_directory=$WORKTREE_DIR`. Paths relative to `REPO_ROOT` hit the primary checkout.
3. Never `move_agent_to_root` / `move_agent_to_cloned_root`. Never merge, push (unless the prompt allows it), remove the worktree, or delete the branch.
4. Commit all work on `EXEC_BRANCH`; `git status` clean before handoff.
5. Return exactly the `## Handoff` block from `~/.cursor/skills/andx-orchestration/SKILL.md` Step 3, with fresh command output from this run.
