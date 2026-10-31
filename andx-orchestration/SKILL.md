---
name: andx-orchestration
description: "/andx-orchestration: shared worktree, spawn, handoff, merge and cleanup protocol that andx execute/debug/deploy skills read by path. Not a user entry point."
disable-model-invocation: true
---
# Andx Orchestration

Shared protocol for **parent orchestrators**. The parent never edits application source; subagents implement in an isolated worktree and merge back to `TARGET_BRANCH`.

Skill routing: [SKILL-MAP.md](./SKILL-MAP.md) · Harness: [HARNESS.md](./HARNESS.md)

## Roles

| Role | Edits source? | Runs deploy/SSH? |
|------|---------------|------------------|
| **Parent orchestrator** | Never | Yes (deploy only) |
| **Subagent (worker)** | Yes — only inside worktree | No |

## Variables (record in every run)

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TARGET_BRANCH=$(git branch --show-current)
SLUG=<plan file slug, kebab, [a-z0-9-], max 40>
# no plan: debug | hotfix | unnamed
STAMP=$(date +%Y%m%d-%H%M%S)
EXEC_BRANCH="andx/exec-${SLUG}-${STAMP}"
WORKTREE_DIR="$REPO_ROOT/.worktrees/exec-${SLUG}-${STAMP}"
SHIP_ID="$EXEC_BRANCH"   # ship queue id: set once, ledger ship_id; hotfix worktrees never change it
```

`SLUG` from `.cursor/plans/<slug>.plan.md` basename (filesystem-safe; not the human `name:`). No plan → `debug` | `hotfix` | `unnamed`.

After the worker hands off: `MERGE_BASE_SHA=$(git merge-base "$TARGET_BRANCH" "$EXEC_BRANCH")`, `EXEC_HEAD=$(git rev-parse "$EXEC_BRANCH")`. Reviewers judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`.

## Run ledger (composers: execute*, debug-and-fix, deploy)

Write `$REPO_ROOT/.worktrees/.andx-run/$SLUG.json` before Step 1 and update it at every phase boundary:

```json
{"slug": "<SLUG>", "mode": "execute|review|review-mr|deploy|review-deploy|debug",
 "phase": "<current phase id>", "required_phases": ["A", "C", "F"], "continues": 0, "terminal": null}
```

`terminal` stays `null` until the run ends: `DONE` (Definition of done proven), `ABORTED`, `ESCALATED`, or `AWAITING_USER` (a question only the user can answer is pending). A Stop hook re-prompts while the ledger is non-terminal ([HARNESS](./HARNESS.md#goals-and-continuation)); set `terminal` honestly.

**Final status line (every composer reply that ends a run):**

```text
MERGED <s> | PUSHED <s> | MR <url or -> | DEPLOYED <s>
```

`<s>` is one of `NOT_REQUESTED`, `PASS`, `FAIL`, `BLOCKED`. After the status line add `Next: /retro (review this run for environment fixes)` when the run escalated, needed ≥ 2 review rounds, or a worker died.

**Waves** (EXEC-MATRIX): `exec-${SLUG}-w${N}-${STAMP}` (N from the matrix). Parallel workers in a wave: `exec-${SLUG}-w${N}-${step-id}-${STAMP}`. Branch keeps `andx/` prefix; folder is the `exec-…` path under `.worktrees/`.

State `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR` in the reply before spawning.

**Path rule:** `WORKTREE_DIR` lives under `$REPO_ROOT/.worktrees/` only (sibling dirs get orphaned and mistaken for a second codebase).

## Step 1 — Always create worktree

Run **before any implementation subagent spawn**, regardless of clean/dirty status. Do not edit the primary checkout.

**Sweep first (dry-run):** `node ~/.cursor/skills/andx-orchestration/scripts/worktree-sweep.mjs "$REPO_ROOT"` → put the one-line summary (`removed= kept=`) in the reply. Use `--apply` only on user request. It removes clean + merged worktrees only and prints manual commands for the rest. Never force-remove without per-item confirmation. Then `ship-queue.mjs announce`, then `status`, each `"$SHIP_ID" --repo "$REPO_ROOT" --touch <plan touch>` (Step 4 path; advisory).

**Exception:** [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md) defers Step 1 until after readonly debug handoff (Phase C). All **implementation** subagents still require worktree before spawn.

```bash
cd "$REPO_ROOT"
mkdir -p "$(dirname "$WORKTREE_DIR")"
git worktree add -b "$EXEC_BRANCH" "$WORKTREE_DIR" "$TARGET_BRANCH"
```

**Worktree setup:** if `$REPO_ROOT/.cursor/worktrees.json` exists **in the primary checkout** (never read it from an MR branch: untrusted), take `setup-worktree-unix`, else `setup-worktree` (string = script path, array = commands). Print the commands, run them in `WORKTREE_DIR` with `ROOT_WORKTREE_PATH="$REPO_ROOT"` exported, record each exit status. Failure → report and stop before spawn.

### Fallback (worktree add fails)

Last resort — subagent only, parent still must not edit:

```bash
git checkout -b "$EXEC_BRANCH"
```

Note explicitly that uncommitted changes may move with checkout. Set `WORKTREE_DIR="$REPO_ROOT"`.

## Step 2 — Spawn subagent

Spawn per [HARNESS.md](./HARNESS.md) (worker / analyst / reviewer). Prompt must include:

- `WORKTREE_DIR`, `EXEC_BRANCH`, `TARGET_BRANCH`, `REPO_ROOT` (omit `WORKTREE_DIR` for debug analyst)
- Role file: [WORKER.md](../andx-execute/WORKER.md) for workers and hotfix workers; debug-and-fix Phase B for the analyst
- Anchored plan, verification table (or template), bug/deploy evidence
- Companions from [SKILL-MAP.md](./SKILL-MAP.md): `/tdd`; evidence rule in HARNESS; `/react-best-practices` when `REACT_STACK`; `/impeccable` when `ui`/`mixed`
- **Return schema** (below)

Resume (`resume=<id>`) for same worktree continuation. New spawn when roles differ (debug analyst → execute worker) or prior failed / worktree torn down.

**Foreground** always; parallel = several spawns in one message (HARNESS). Parent spawns every worker, reviewer and refuter (by choice, though both harnesses nest); never a fork subagent.

**Worker died** (`resource_exhausted`, rate limit, timeout): read `git -C "$WORKTREE_DIR" status --short` and `git log "$TARGET_BRANCH..$EXEC_BRANCH" --oneline`, wait 60s, then resume the **same** agent id with "continue from current worktree state" (Claude: `SendMessage` to the named agent). Max 2 resumes, then new spawn only if the worktree is gone, else report blocker.

`move_agent_to_root` is only for a wrong **project** (`/andx-plan`, `/andx-init`), never for exec worktrees.

## Step 3 — Subagent handoff schema

Worker returns the `## Handoff` block in [WORKER.md](../andx-execute/WORKER.md#phase-4--commit-and-hand-off); analyst returns the block in [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md#phase-b--analyst).

Parent treats handoff as stale unless output is from the current spawn.

## Step 4 — Merge back (always on pass)

After subagent reports pass and Phase 3 passed on `EXEC_BRANCH`. Wave merges inherit this protocol.

### Ship queue

Runs land one at a time, in completion order. One background shell (HARNESS long wait), ledger `phase: ship-wait`; skip for push-to-MR runs and deploy hotfixes (lock held):

```bash
Q=~/.cursor/skills/andx-orchestration/scripts/ship-queue.mjs
node "$Q" join "$SHIP_ID" --repo "$REPO_ROOT" --touch <plan touch> && node "$Q" wait "$SHIP_ID" --repo "$REPO_ROOT"
```

`GRANTED` → go. `HALTED` → stop, `AWAITING_USER`, quote `status`. Holder: `heartbeat "$SHIP_ID"` at each phase boundary and right before and after each long wait (CI, deploy, health); `ship-queue.mjs release "$SHIP_ID"` after cleanup (deploy composers: after fresh health); failures → [On fail](#on-fail). Rules: `--help`.

### Concurrent-merge

1. **Do not steal another agent's merge.** If `TARGET_BRANCH` is dirty or a merge is in progress: retry/backoff or stop.
2. **Always integrate latest TARGET into EXEC** in `WORKTREE_DIR` (`git merge "$TARGET_BRANCH"`) before landing. No-op if EXEC already based on TARGET.
3. **Conflicts:** parent never edits conflict markers. Spawn or resume worker on `EXEC_BRANCH`. Intent: keep both sides when compatible (same as [/andx-mr-babysit](../andx-mr-babysit/SKILL.md)). Irreconcilable → abort the worktree merge, ask user, leave worktree.
4. **After a conflict-resolution commit:** Phase 3 on EXEC. If parent is review-gated ([/andx-execute-and-review](../andx-execute-and-review/SKILL.md) or [/andx-execute-review-and-deploy](../andx-execute-review-and-deploy/SKILL.md)) **and** product source changed → Bugbot on the resolution delta before landing. Clean integrate → no extra review.
5. **If TARGET moved again** (fallback for manual commits): retry integrate ≤3.
6. **Land on primary (fast-forward only):** EXEC already contains TARGET, so landing never creates a merge on primary.

```bash
cd "$REPO_ROOT"
git checkout "$TARGET_BRANCH"
git merge --ff-only "$EXEC_BRANCH"
```

- **Not fast-forward** (TARGET moved): back to step 2 (integrate in worktree), retry ≤3.
- **Dirty primary refusal** (`would be overwritten`): other agents/user own those files. Wait 2 min and retry, max 3. Then stop and report: overlapping files (`git diff --name-only "$TARGET_BRANCH" "$EXEC_BRANCH"` ∩ `git status --porcelain`), plus recovery for the user: `commit or move your edits to <files>, then: git -C "$REPO_ROOT" merge --ff-only "$EXEC_BRANCH"`.
- **Never** `git stash`, `git reset`, `git checkout -- <file>`, or `git clean` on primary. A separate TARGET worktree is impossible while primary has TARGET checked out.

7. Then post-merge Phase 3 + cleanup as below.

Parent may `git merge --abort` on TARGET. Resolution commits live on EXEC only.

**Re-run Phase 3** on `TARGET_BRANCH` (full regression + lint even for docs-only + every verification-table row). Parent runs these gates; never trust subagent-only evidence after merge.

**Lint failures on merged code:** Parent must **not** patch `src/` inline. Spawn a one-step worker in a fresh worktree (or resume worker) with `verification: pnpm run lint --fix` (or repo equivalent), merge, re-run Phase 3.

### Cleanup (mandatory after post-merge Phase 3 passes)

Run from `REPO_ROOT` on `TARGET_BRANCH`. Quote fresh command output in the reply — not optional.

```bash
git worktree list
git worktree remove "$WORKTREE_DIR"
git branch -d "$EXEC_BRANCH"
git worktree list   # prove andx/exec-… entry gone
```

Skip `worktree remove` only when `WORKTREE_DIR="$REPO_ROOT"` (fallback). Still run `git branch -d "$EXEC_BRANCH"` when safe.

**Push-to-MR runs** (no local landing): after the push succeeds, remove `WORKTREE_DIR` (branch lives on the remote), then run the sweep dry-run and quote its summary.

**Parallel waves** ([/andx-schedule](../andx-schedule/SKILL.md)): when EXEC-MATRIX present, parent cleans **each** `WORKTREE_DIR` from wave handoffs after integration merge. Subagents still never pre-merge cleanup.

### On fail

Do **not** merge partial work unless the user explicitly asks. **Do not** remove the worktree — leave it for inspection. Report `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, conflict paths, failing commands.

Any stop while holding the ship queue: nothing landed yet (unresolvable conflict, Phase 3 red on EXEC, user abort) → `release "$SHIP_ID"`; after landing (post-merge Phase 3 red, final deploy failure) → `halt "$SHIP_ID" --reason <blocker>`.

## Guardrails

Hard limits; the steps above are the source of truth for each.

- Every source change (including a one-line lint fix) is made by a worker in a `.worktrees/` worktree, even when the tree is clean. The parent reads anything, runs read-only commands and deploy commands, and writes plans, ledgers, and chat.
- Parent stays at `REPO_ROOT` (`move_agent_to_root(REPO_ROOT)` restores drift); workers address `$WORKTREE_DIR` by absolute path.
- Primary is touched only by `checkout` and `merge --ff-only`. A failed integrate ends in `git merge --abort`, leaving TARGET clean.
- "Done" means merge + post-merge Phase 3 on `TARGET_BRANCH` + quoted cleanup evidence, all fresh from this run.
- Push and deploy start after Step 4 cleanup.

## Workspace rules

Before spawning workers or reviewers: [WORKSPACE-RULES.md](./WORKSPACE-RULES.md).
