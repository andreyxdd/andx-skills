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
```

`SLUG` from `.cursor/plans/<slug>.plan.md` basename (filesystem-safe; not the human `name:`). No plan → `debug` | `hotfix` | `unnamed`.

After the worker hands off: `MERGE_BASE_SHA=$(git merge-base "$TARGET_BRANCH" "$EXEC_BRANCH")`, `EXEC_HEAD=$(git rev-parse "$EXEC_BRANCH")`. Reviewers judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`.

## Run ledger (composers: execute*, debug-and-fix, deploy)

Write `$REPO_ROOT/.worktrees/.andx-run/$SLUG.json` before Step 1 and update it at every phase boundary:

```json
{"slug": "<SLUG>", "mode": "execute|review|review-mr|deploy|review-deploy|debug",
 "phase": "<current phase id>", "required_phases": ["A", "C", "F"], "continues": 0, "terminal": null}
```

`terminal` stays `null` until the run ends: `DONE` (Definition of done proven), `ABORTED`, `ESCALATED`, or `AWAITING_USER` (a question only the user can answer is pending). A Stop hook (`hooks/andx_continue.rb`) sends the agent back to work while the ledger written in this conversation is non-terminal (max 5 pushes). Set `terminal` honestly; never set `DONE` to silence the hook.

**Cursor goal (optional, parent only):** call `CreateGoal` exactly once with `{"objective": "<mode-scoped Definition of done>"}` (MR mode never requires DEPLOYED). Call `UpdateGoal` with `{"status": "complete"}` only after a requirement-by-requirement audit with fresh output. Claude has no model-armed goal; the ledger hook covers it.

**Final status line (every composer reply that ends a run):**

```text
MERGED <s> | PUSHED <s> | MR <url or -> | DEPLOYED <s>
```

`<s>` is one of `NOT_REQUESTED`, `PASS`, `FAIL`, `BLOCKED`.

**Waves** (EXEC-MATRIX): `exec-${SLUG}-w${N}-${STAMP}` (N from the matrix). Parallel workers in a wave: `exec-${SLUG}-w${N}-${step-id}-${STAMP}`. Branch keeps `andx/` prefix; folder is the `exec-…` path under `.worktrees/`.

State `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR` in the reply before spawning.

**Path rule:** `WORKTREE_DIR` only under `$REPO_ROOT/.worktrees/`. Do not reuse ad-hoc sibling directory names (`*-exec/`, `*-andx-*` at repo parent) — they are easy to orphan and confuse later sessions as a second codebase.

## Step 1 — Always create worktree

Run **before any implementation subagent spawn**, regardless of clean/dirty status. Do not edit the primary checkout.

**Sweep first (dry-run):** `bash ~/.cursor/skills/andx-orchestration/scripts/worktree-sweep.sh "$REPO_ROOT"` → put the one-line summary (`removed= kept=`) in the reply. Use `--apply` only on user request. It removes clean + merged worktrees only and prints manual commands for the rest. Never force-remove without per-item confirmation.

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
- Worker skill section (andx-execute Worker, debug analyst, deploy-hotfix worker)
- Anchored plan, verification table (or template), bug/deploy evidence
- Companions from [SKILL-MAP.md](./SKILL-MAP.md): `/tdd`; evidence rule in HARNESS; `/react-best-practices` when `REACT_STACK`; `/impeccable` when `ui`/`mixed`
- **Return schema** (below)

Resume (`resume=<id>`) for same worktree continuation. New spawn when roles differ (debug analyst → execute worker) or prior failed / worktree torn down.

**Foreground:** spawn workers, reviewers, and Bugbot with `run_in_background: false`. Parallel work = several Task calls in one message (the parent blocks until all return). Background spawns end the parent's turn and caused most stalled pipelines.

**Worker died** (`resource_exhausted`, rate limit, timeout): read `git -C "$WORKTREE_DIR" status --short` and `git log "$TARGET_BRANCH..$EXEC_BRANCH" --oneline`, wait 60s, then resume the **same** agent id with "continue from current worktree state" (Claude: `SendMessage` to the named agent). Max 2 resumes, then new spawn only if the worktree is gone, else report blocker.

### Subagent workspace rules

- **Parent stays at `REPO_ROOT`.** Never `move_agent_to_root` or `move_agent_to_cloned_root` to a worktree.
- **Worker:** every Read/Write/StrReplace/Shell uses **absolute** `$WORKTREE_DIR/...` paths, or Shell `working_directory=$WORKTREE_DIR`. Relative paths from `REPO_ROOT` are **forbidden** (they hit the primary TARGET checkout). Prompt **forbids** `move_agent_to_root(WORKTREE_DIR)` and `move_agent_to_cloned_root`. Spawn agent `andx-worker` in the **same** workspace; instruct cwd in the prompt only (HARNESS).
- After handoff: if workspace drifted, parent `move_agent_to_root(REPO_ROOT)` to restore.
- Still allowed: `move_agent_to_root` when the **project** is wrong (`/andx-plan`, `/andx-init`) — not for exec worktrees.
- Commits land on `EXEC_BRANCH` only; do not push unless the prompt explicitly allows it
- Before handoff: `git status` must be **clean** on `EXEC_BRANCH`; all work committed
- **Do not** run `git worktree remove` or `git branch -d` — parent owns cleanup after merge
- Do not merge; return handoff to parent with `worktree_preserved: true` and `WORKTREE_DIR`

## Step 3 — Subagent handoff schema

Subagent must return:

```markdown
## Handoff

- **Status:** pass | fail
- **EXEC_BRANCH:** andx/exec-…
- **WORKTREE_DIR:** …
- **worktree_preserved:** true
- **Pre-handoff git status:** clean | dirty (must be clean on pass)
- **Commits:** `git log TARGET_BRANCH..EXEC_BRANCH --oneline`
- **Verification table:** (each row: command, outcome, snippet)
- **Phase 3 regression:** command + outcome on EXEC_BRANCH
- **Blockers:** (if fail) symptom, attempts, next experiment
```

Parent treats handoff as stale unless output is from the current spawn.

## Debug analyst handoff (readonly — andx-debug-and-fix Phase B)

Readonly subagent returns **before** worktree creation. No commits. Parent maps this into an execution plan for Phase D.

```markdown
## Debug analyst handoff

- **Status:** pass | fail | inconclusive
- **Feedback loop:** one command + its red output (red-capable, deterministic, fast)
- **Minimised repro:** smallest scenario still red
- **Hypotheses:** 3–5 ranked, each with its prediction and status (confirmed / killed / open)
- **Correct seam:** where the regression test belongs, or `none` (that is a finding)
- **Issue:** …
- **Evidence:** …
- **Investigation:** …
- **Root Cause:** … (with evidence)
- **Recommended Fix:** files, lines, minimal change description
- **Verification Plan:** commands/tests post-fix
- **Risk Assessment:** side effects, confidence
- **Blockers:** (if fail/inconclusive) next falsifiable experiment
```

Execute worker spawn prompt must include the full debug handoff as anchored plan context.

## Step 4 — Merge back (always on pass)

After subagent reports pass and Phase 3 passed on `EXEC_BRANCH`. Wave merges inherit this protocol.

### Concurrent-merge

1. **Do not steal another agent's merge.** If `TARGET_BRANCH` is dirty or a merge is in progress: retry/backoff or stop.
2. **Always integrate latest TARGET into EXEC** in `WORKTREE_DIR` (`git merge "$TARGET_BRANCH"`) before landing. No-op if EXEC already based on TARGET.
3. **Conflicts:** parent never edits conflict markers. Spawn or resume worker on `EXEC_BRANCH`. Intent: keep both sides when compatible (same as [/andx-mr-babysit](../andx-mr-babysit/SKILL.md)). Irreconcilable → abort the worktree merge, ask user, leave worktree.
4. **After a conflict-resolution commit:** Phase 3 on EXEC. If parent is review-gated ([/andx-execute-and-review](../andx-execute-and-review/SKILL.md) or [/andx-execute-review-and-deploy](../andx-execute-review-and-deploy/SKILL.md)) **and** product source changed → re-run always reviewers 1–3 before landing. Clean integrate → no extra review.
5. **If TARGET moved again:** retry integrate ≤3.
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

**Anti-pattern:** leaving TARGET with conflict markers / merge in progress.

**Re-run Phase 3** on `TARGET_BRANCH` (full regression + every verification-table row). Parent runs these gates — do not trust subagent-only evidence after merge.

**Post-merge/rebase lint (mandatory):** Run discovered lint on `TARGET_BRANCH` even for docs-only plans. A merge from `main` can fail CI on formatting in files the plan never touched.

**Lint failures on merged code:** Parent must **not** patch `src/` inline. Spawn a one-step worker in a fresh worktree (or resume worker) with `verification: pnpm run lint --fix` (or repo equivalent), merge, re-run Phase 3.

### Cleanup (mandatory after post-merge Phase 3 passes)

Run from `REPO_ROOT` on `TARGET_BRANCH`. Quote fresh command output in the reply — not optional.

```bash
git worktree list
git worktree remove "$WORKTREE_DIR"   # skip only for same-checkout fallback
git branch -d "$EXEC_BRANCH"
git worktree list   # prove andx/exec-… entry gone
```

Skip `worktree remove` only when `WORKTREE_DIR="$REPO_ROOT"` (fallback). Still run `git branch -d "$EXEC_BRANCH"` when safe.

**Push-to-MR runs** (no local landing): after the push succeeds, remove `WORKTREE_DIR` (branch lives on the remote), then run the sweep dry-run and quote its summary.

**Before push or deploy:** Cleanup is part of Step 4, not optional post-ship housekeeping. [/andx-execute-and-deploy](../andx-execute-and-deploy/SKILL.md) and [/andx-execute-review-and-deploy](../andx-execute-review-and-deploy/SKILL.md) must not start Phase A′ until cleanup evidence is logged — even if prod is still failing and the session continues debugging.

**Parallel waves** ([/andx-schedule](../andx-schedule/SKILL.md)): when EXEC-MATRIX present, parent cleans **each** `WORKTREE_DIR` from wave handoffs after integration merge. Subagents still never pre-merge cleanup.

### On fail

Do **not** merge partial work unless the user explicitly asks. **Do not** remove the worktree — leave it for inspection. Report `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, conflict paths, failing commands.

## Parent allowed actions

- Read files anywhere in repo
- Run read-only commands (tests, curl, git log/status) on primary checkout
- Create/remove worktrees, checkout, `git merge --ff-only "$EXEC_BRANCH"` on `TARGET_BRANCH` (no other commits on primary)
- `git merge --abort` on TARGET (never leave TARGET conflicted)
- `move_agent_to_root(REPO_ROOT)` to restore after drift; `move_agent_to_root` when the **project** is wrong (`/andx-plan`, `/andx-init`)
- Deploy commands (SSH, make deploy, health checks)
- Write plans, verification tables, progress updates in chat

## Parent forbidden actions

- `StrReplace` / `Write` on application source, tests, migrations, or config in primary checkout (including trivial prettier/eslint fixes — spawn worker instead)
- `move_agent_to_root` / `move_agent_to_cloned_root` to an exec worktree
- Claiming "done" before merge + post-merge Phase 3 on `TARGET_BRANCH`
- Reusing stale subagent output without fresh post-merge gates
- Skipping worktree because the tree is clean
- Push, deploy, or `git push heroku` before Step 4 cleanup completes
- Ad-hoc `WORKTREE_DIR` outside `.worktrees/` (orphan risk; later agents may treat it as a permanent second tree)
- Leaving TARGET with conflict markers or a merge in progress
- `git stash` / `reset` / `clean` / `checkout -- <file>` on primary to make landing work

## Anti-patterns

- Parent patches source during orchestration (including editing the worktree inline when a subagent should run)
- Subagent merges to `TARGET_BRANCH` itself
- Subagent removes worktree before parent merge
- `move_agent_to_root` to `WORKTREE_DIR` (opens an extra Cursor workspace)
- "Done" on exec branch before parent merge
- Parent claims done without cleanup evidence (`git worktree list` before/after)
- Orphan `.worktrees/exec-*` or ad-hoc `*-exec/` worktrees left after successful merge
- Push or deploy before Step 4 cleanup when merge + post-merge Phase 3 passed
- Deploy before merge + post-merge verify when code changed
- Deferring cleanup because follow-up prod debugging started in the same session
- Leaving TARGET conflicted / merge in progress instead of `git merge --abort`

## Referenced by

- [HARNESS.md](./HARNESS.md) — Cursor/Claude spawn matrix
- [SKILL-MAP.md](./SKILL-MAP.md) — companion skill routing
- [/andx-init](../andx-init/SKILL.md)
- [/andx-plan](../andx-plan/SKILL.md)
- [/andx-schedule](../andx-schedule/SKILL.md)
- [/andx-execute](../andx-execute/SKILL.md)
- [/andx-execute-and-review](../andx-execute-and-review/SKILL.md)
- [/andx-execute-review-and-deploy](../andx-execute-review-and-deploy/SKILL.md)
- [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md)
- [/andx-execute-and-deploy](../andx-execute-and-deploy/SKILL.md)
- [/andx-deploy](../andx-deploy/SKILL.md) — hotfix loop only
- [/andx-mr-review](../andx-mr-review/SKILL.md)
