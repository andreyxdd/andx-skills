# 0001: Landing stays on ship-queue, not `wt merge`

Status: accepted (2026-11-01)

## Context

worktrunk (`wt`) is now an optional backend for creating and removing run worktrees. It also has `wt merge`, which squashes or rebases a branch onto its target, runs hooks, fast-forwards the target and removes the worktree. Using it would replace `ship-queue.mjs land`.

## Decision

Landing goes through `ship-queue.mjs land` in every backend mode. `wt` is used only for `switch`, `remove`, `step copy-ignored` and `step eval`.

## Why

- **History:** `wt merge` rebases the exec branch onto the target. Wave runs merge step branches into the exec branch with merge commits; a rebase flattens them, so the per-step history reviewers and `git log TARGET..EXEC` rely on is lost.
- **Moving target:** `wt merge --no-rebase` keeps the merges but fails as soon as the target has moved, which is the normal case when several runs ship from one repo.
- **Concurrency:** `land` runs under the ship queue: one holder at a time across chats, generation fencing so a stale holder cannot land, halt and resume after a failed post-merge check. `wt merge` has no cross-process lock or fencing.
- **What lands:** by default `wt merge` stages and commits everything in the worktree, untracked files included (`--stage all`). `land` integrates only what the worker committed and verified.
- **Primary checkout:** `land` fast-forwards the target without switching branches in the primary checkout and refuses when it is dirty. Matching that through `wt merge` and its hooks would mean re-implementing the same checks around it.

## Consequences

- Users on the `wt` backend still see runs in `wt list` (markers, ports) and can use worktrunk's own commands on their branches by hand.
- If `wt merge` gains merge-commit landing onto a moved target plus an external lock, revisit this ADR; until then a change to landing goes into `ship-queue.mjs`.
