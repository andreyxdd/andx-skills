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

`run.mjs start` (Step 1) writes the ledger and prints `REPO_ROOT`, `TARGET_BRANCH`, `STAMP`, `EXEC_BRANCH`, `WORKTREE_DIR`, `SHIP_ID`; state them before spawning. `SLUG` = plan basename (`<slug>.plan.md`); no plan → `debug` | `hotfix` | `unnamed`.

After the handoff: `MERGE_BASE_SHA=$(git merge-base "$TARGET_BRANCH" "$EXEC_BRANCH")`, `EXEC_HEAD=$(git rev-parse "$EXEC_BRANCH")`. Reviewers judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`.

## Run ledger (composers: execute*, debug-and-fix, deploy)

- Record each composer phase id when reached: `node "$S/run.mjs" phase "$SLUG" <id>` (required ids: `node "$S/run.mjs" --help`).
- End: `node "$S/run.mjs" end "$SLUG" --terminal DONE|ABORTED|ESCALATED|AWAITING_USER --merged … --pushed … --mr … --deployed …` (DONE needs every required phase; `AWAITING_USER` = a question only the user can answer). The reply ends with the status line it prints, plus `Next: /retro (review this run for environment fixes)` when the run escalated, needed ≥ 2 review rounds, or a worker died.
- While it is non-terminal, hooks re-prompt the parent and lock the primary checkout ([HARNESS](./HARNESS.md#goals-and-continuation)); never end DONE to silence them.

## Step 1 — Create the worktree

First `node "$S/run.mjs" start --slug "$SLUG" --mode <composer's mode>`. Then, before any implementation spawn, clean tree or not ([/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md) defers these to its Phase C):

1. Stale worktrees: `node "$S/worktree.mjs" sweep`; quote its `removed= kept=`. `--apply` only on user request.
2. Overlap warning (advisory): `node "$S/ship-queue.mjs" announce "$SHIP_ID" --touch <plan touch>`, then `node "$S/ship-queue.mjs" status "$SHIP_ID" --touch <plan touch>`.
3. `node "$S/worktree.mjs" create --slug "$SLUG"` (wave worktrees: [/andx-schedule](../andx-schedule/SKILL.md)); quote `BACKEND=` and each setup exit code. Non-zero → report, stop.

## Step 2 — Spawn subagent

Per [HARNESS.md](./HARNESS.md). Prompt: `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, `PORT` (not for the analyst); role file [WORKER.md](../andx-execute/WORKER.md) for workers, debug-and-fix Phase B for the analyst; anchored plan, verification table, bug/deploy evidence; companions per [SKILL-MAP.md](./SKILL-MAP.md); the Step 3 return schema.

Resume (`resume=<id>`) in the same worktree; new spawn when the role changes (analyst → worker) or the worktree is gone. **Worker died** (`resource_exhausted`, rate limit, timeout): check `git -C "$WORKTREE_DIR" status --short` and `git log "$TARGET_BRANCH..$EXEC_BRANCH" --oneline`, wait 60s, resume the **same** id ("continue from current worktree state"; Claude: `SendMessage`). After 2 resumes: new spawn only if the worktree is gone, else report the blocker.

## Step 3 — Subagent handoff schema

Worker: `## Handoff` in [WORKER.md](../andx-execute/WORKER.md#phase-4--commit-and-hand-off); analyst: the block in [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md#phase-b--analyst). Older handoffs are stale.

## Step 4 — Land (always on pass)

After a pass handoff with Phase 3 green on `EXEC_BRANCH`. Queue, landing, release and halt rules: `node "$S/ship-queue.mjs" --help`.

1. **Queue** (not for push-to-MR runs), one background shell (HARNESS long wait): `node "$S/ship-queue.mjs" join "$SHIP_ID" --touch <plan touch> && node "$S/ship-queue.mjs" wait "$SHIP_ID"`. `GRANTED` → go; `HALTED` → stop, `node "$S/run.mjs" end "$SLUG" --terminal AWAITING_USER`, quote `node "$S/ship-queue.mjs" status "$SHIP_ID"`. Holder: `node "$S/ship-queue.mjs" heartbeat "$SHIP_ID"` at phase boundaries and around long waits (CI, deploy, health).
2. **Land:** `node "$S/ship-queue.mjs" land "$SHIP_ID" --worktree "$WORKTREE_DIR" --test "<plan verification + regression>"`. `CONFLICT` (exit 6, also from `join`) → item 3. Exit 9 → follow its message; dirty primary → wait 2 min, retry ≤ 3, then report overlapping files + the user's recovery `git -C "$REPO_ROOT" merge --ff-only "$EXEC_BRANCH"`.
3. **Conflicts:** the worker (never the parent) resolves them on `EXEC_BRANCH`, keeping both sides when compatible (irreconcilable → abort the merge, ask the user). Then Phase 3 on EXEC; review-gated parents run Bugbot on the resolution delta when product source changed.
4. **Post-merge Phase 3** on `TARGET_BRANCH`, run by the parent: regression + lint (even docs-only) + every verification row. A fix after landing (lint red, deploy hotfix) can't use `land` (it takes only the run worktree): a worker in `node "$S/worktree.mjs" create --slug hotfix` (its `EXEC_BRANCH=` is `HOTFIX_BRANCH`) integrates `TARGET_BRANCH`, goes green, then `git -C "$REPO_ROOT" merge --ff-only "$HOTFIX_BRANCH"` (primary not on TARGET → stop) and `node "$S/worktree.mjs" remove hotfix`.
5. **Cleanup:** `node "$S/worktree.mjs" remove "$SLUG"`; quote its before/after `git worktree list`. Push-to-MR runs: remove after the push, then `node "$S/worktree.mjs" sweep`.
6. **Release:** `node "$S/ship-queue.mjs" release "$SHIP_ID" --after-deploy` (`--deploy` runs: andx-deploy releases after fresh health).

### On fail

No partial merge unless asked; keep the worktree; report branches, `WORKTREE_DIR`, conflict paths, failing commands. Holding the lock: stop before this run landed → `node "$S/ship-queue.mjs" release "$SHIP_ID"`; after it landed (post-merge Phase 3 red, deploy failed or abandoned) → `node "$S/ship-queue.mjs" halt "$SHIP_ID" --reason <blocker>`, end `AWAITING_USER`; conflict question pending → keep the lock. Then `node "$S/run.mjs" end "$SLUG" --terminal ABORTED|ESCALATED|AWAITING_USER`.

## Guardrails

- The parent never edits source, even a one-line lint fix (a worker does, in `.worktrees/`); it reads anything, runs read-only and deploy commands, writes plans, ledgers and chat.
- The parent stays at `REPO_ROOT` (`move_agent_to_root(REPO_ROOT)` fixes drift); workers use absolute `$WORKTREE_DIR` paths.
- The primary checkout changes only by `land` or item 4's `merge --ff-only`; never `git stash`, `reset`, `checkout` or `clean` there.
- "Done" = landed + post-merge Phase 3 + quoted cleanup, all fresh. Push and deploy start after cleanup.

## Workspace rules

Before spawning workers or reviewers: [WORKSPACE-RULES.md](./WORKSPACE-RULES.md).
