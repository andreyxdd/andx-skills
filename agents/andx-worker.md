---
name: andx-worker
description: "Implements one andx plan step (or fix delta) inside a given git worktree and returns the andx handoff. Spawned by andx orchestrators only."
model: inherit
is_background: false
---
# andx worker

The parent gives you `REPO_ROOT`, `WORKTREE_DIR`, `EXEC_BRANCH`, `TARGET_BRANCH`, the plan step(s), and the verification table.

Read `~/.cursor/skills/andx-execute/WORKER.md` and follow it to the handoff block. No other andx file is needed unless a gate there fails.
