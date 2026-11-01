---
name: andx-orchestration
description: "/andx-orchestration: shared worktree, spawn, handoff, merge and cleanup protocol that andx execute/debug/deploy skills read by path. Not a user entry point."
disable-model-invocation: true
---
# Andx Orchestration

Protocol for **parent orchestrators**. Each lifecycle step is one CLI call whose `--help` holds the rules.

Skill routing: [SKILL-MAP.md](./SKILL-MAP.md) · Harness: [HARNESS.md](./HARNESS.md)

```bash
S=~/.cursor/skills/andx-orchestration/scripts   # run.mjs, worktree.mjs, ship-queue.mjs; run from REPO_ROOT
```

## Variables

`run.mjs start` (Step 1) writes the ledger and prints `REPO_ROOT`, `TARGET_BRANCH`, `STAMP`, `EXEC_BRANCH`, `WORKTREE_DIR`, `SHIP_ID`; state them in the reply before spawning. `SLUG` = plan file basename (`.cursor/plans/<slug>.plan.md`); no plan → `debug` | `hotfix` | `unnamed`.

After the handoff: `MERGE_BASE_SHA=$(git merge-base "$TARGET_BRANCH" "$EXEC_BRANCH")`, `EXEC_HEAD=$(git rev-parse "$EXEC_BRANCH")`. Reviewers judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`.

## Run ledger (composers: execute*, debug-and-fix, deploy)

- Record each phase id the composer names when it is reached: `node "$S/run.mjs" phase "$SLUG" <id>` (required ids per mode: `--help`).
- End: `node "$S/run.mjs" end "$SLUG" --terminal DONE|ABORTED|ESCALATED|AWAITING_USER --merged … --pushed … --mr … --deployed …` (DONE needs every required phase; `AWAITING_USER` = a question only the user can answer). The reply ends with the status line it prints, plus `Next: /retro (review this run for environment fixes)` when the run escalated, needed ≥ 2 review rounds, or a worker died.
- While the ledger is non-terminal, hooks re-prompt the parent and keep the primary checkout read-only ([HARNESS](./HARNESS.md#goals-and-continuation)); never end DONE to silence them.

## Step 1 — Create the worktree

First `node "$S/run.mjs" start --slug "$SLUG" --mode <composer's mode>`. Then, before any implementation spawn, clean tree or not ([/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md) defers these to its Phase C):

1. Stale worktrees: `node "$S/worktree.mjs" sweep`; quote its `removed= kept=` line. `--apply` only on user request.
2. Overlap warning (advisory): `node "$S/ship-queue.mjs" announce "$SHIP_ID" --touch <plan touch>`, then `status` with the same arguments.
3. `node "$S/worktree.mjs" create --slug "$SLUG"` (wave worktrees: [/andx-schedule](../andx-schedule/SKILL.md)); quote each setup exit code. Non-zero exit → report and stop before spawning.

## Step 2 — Spawn subagent

Per [HARNESS.md](./HARNESS.md). Prompt: `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR` (not for the analyst); role file [WORKER.md](../andx-execute/WORKER.md) for workers, debug-and-fix Phase B for the analyst; anchored plan, verification table, bug/deploy evidence; companions from [SKILL-MAP.md](./SKILL-MAP.md) (`/tdd`, `/react-best-practices` when `REACT_STACK`, `/impeccable` for `ui`/`mixed`); the Step 3 return schema.

Resume (`resume=<id>`) in the same worktree; new spawn when the role changes (analyst → worker) or the worktree is gone. **Worker died** (`resource_exhausted`, rate limit, timeout): read `git -C "$WORKTREE_DIR" status --short` and `git log "$TARGET_BRANCH..$EXEC_BRANCH" --oneline`, wait 60s, resume the **same** id with "continue from current worktree state" (Claude: `SendMessage`). Max 2 resumes; then a new spawn only if the worktree is gone, else report the blocker.

## Step 3 — Subagent handoff schema

Worker: `## Handoff` in [WORKER.md](../andx-execute/WORKER.md#phase-4--commit-and-hand-off); analyst: the block in [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md#phase-b--analyst). A handoff not from the current spawn is stale.

## Step 4 — Land (always on pass)

After a pass handoff with Phase 3 green on `EXEC_BRANCH`. Queue, landing, release and halt rules: `node "$S/ship-queue.mjs" --help`.

1. **Queue** (not for push-to-MR runs), one background shell (HARNESS long wait): `node "$S/ship-queue.mjs" join "$SHIP_ID" --touch <plan touch> && node "$S/ship-queue.mjs" wait "$SHIP_ID"`. `GRANTED` → go; `HALTED` → stop, end `AWAITING_USER`, quote `status`. Holder: `heartbeat "$SHIP_ID"` at each phase boundary and before and after each long wait (CI, deploy, health).
2. **Land:** `node "$S/ship-queue.mjs" land "$SHIP_ID" --worktree "$WORKTREE_DIR" --test "<plan verification + regression>"`. `CONFLICT` (exit 6, also from `join`) → item 3. Exit 9 → follow its message; dirty primary → wait 2 min, retry ≤ 3, then report overlapping files and the user's recovery `git -C "$REPO_ROOT" merge --ff-only "$EXEC_BRANCH"`.
3. **Conflicts:** the parent never edits conflict markers; the worker resolves on `EXEC_BRANCH`, keeping both sides when compatible (irreconcilable → abort the merge, ask the user). Then Phase 3 on EXEC; review-gated parents run Bugbot on the resolution delta when product source changed.
4. **Post-merge Phase 3** on `TARGET_BRANCH`, run by the parent: full regression + lint (even docs-only) + every verification-table row. A fix after landing (lint red, deploy hotfix; `land` exits 7): a worker in `worktree.mjs create --slug hotfix` integrates `TARGET_BRANCH`, goes green, then `git -C "$REPO_ROOT" merge --ff-only "$EXEC_BRANCH"` (primary not on TARGET → stop) and `worktree.mjs remove hotfix`.
5. **Cleanup:** `node "$S/worktree.mjs" remove "$SLUG"`; quote its before/after `git worktree list`. Push-to-MR runs: remove after the push succeeds, then sweep.
6. **Release:** `node "$S/ship-queue.mjs" release "$SHIP_ID" --after-deploy` (deploy composers: andx-deploy, after fresh health).

### On fail

No partial merge unless asked; keep the worktree. Report `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, conflict paths, failing commands. Holding the lock: stop before this run landed → `release "$SHIP_ID"`; stop after it landed (post-merge Phase 3 red, deploy failed or abandoned) → `halt "$SHIP_ID" --reason <blocker>`, end `AWAITING_USER`; conflict question pending → keep the lock (detail: `--help`). Then `run.mjs end` (ABORTED, ESCALATED or AWAITING_USER).

## Guardrails

- The parent never edits source (even a one-line lint fix): a worker does, in a `.worktrees/` worktree. The parent reads anything, runs read-only and deploy commands, and writes plans, ledgers and chat.
- The parent stays at `REPO_ROOT` (`move_agent_to_root(REPO_ROOT)` restores drift; never move to a worktree); workers use absolute `$WORKTREE_DIR` paths.
- The primary checkout changes only by `land` or item 4's `merge --ff-only`; never `git stash`, `reset`, `checkout` or `clean` there.
- "Done" = landed + post-merge Phase 3 + quoted cleanup, fresh from this run. Push and deploy start after cleanup.

## Workspace rules

Before spawning workers or reviewers: [WORKSPACE-RULES.md](./WORKSPACE-RULES.md).
