---
name: andx-orchestration
description: Parent-orchestrator protocol for andx skills — always-on worktree isolation, subagent spawn contract, merge-back to checked-out branch, and handoff schema. Use when /andx-execute, /andx-execute-and-review, /andx-execute-review-and-deploy, /andx-debug-and-fix, /andx-execute-and-deploy, or /andx-deploy spawns implementation work.
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

**Waves** (EXEC-MATRIX): `exec-${SLUG}-w${N}-${STAMP}` (N from the matrix). Parallel workers in a wave: `exec-${SLUG}-w${N}-${step-id}-${STAMP}`. Branch keeps `andx/` prefix; folder is the `exec-…` path under `.worktrees/`.

State `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR` in the reply before spawning.

**Path rule:** `WORKTREE_DIR` only under `$REPO_ROOT/.worktrees/`. Do not reuse ad-hoc sibling directory names (`*-exec/`, `*-andx-*` at repo parent) — they are easy to orphan and confuse later sessions as a second codebase.

## Step 1 — Always create worktree

Run **before any implementation subagent spawn**, regardless of clean/dirty status. Do not edit the primary checkout.

**Exception:** [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md) defers Step 1 until after readonly debug handoff (Phase C). All **implementation** subagents still require worktree before spawn.

```bash
cd "$REPO_ROOT"
mkdir -p "$(dirname "$WORKTREE_DIR")"
git worktree add -b "$EXEC_BRANCH" "$WORKTREE_DIR" "$TARGET_BRANCH"
```

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

### Subagent workspace rules

- **Parent stays at `REPO_ROOT`.** Never `move_agent_to_root` or `move_agent_to_cloned_root` to a worktree.
- **Worker** uses `WORKTREE_DIR` as tool cwd / absolute paths (Read/Write/StrReplace/Shell). Prompt **forbids** `move_agent_to_root(WORKTREE_DIR)` and `move_agent_to_cloned_root`. Spawn `generalPurpose` in the **same** Cursor workspace; instruct cwd in the prompt only (HARNESS).
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
- **Repro criterion:** command + outcome (must fail before fix)
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
6. **Land on primary:**

```bash
cd "$REPO_ROOT"
git checkout "$TARGET_BRANCH"
git merge "$EXEC_BRANCH"
```

If conflicts or index lock: `git merge --abort` (never leave TARGET conflicted), go back to worktree integrate, retry ≤3.

7. Then post-merge Phase 3 + cleanup as below.

Parent may `git merge --abort` on TARGET. Still only merge commits on TARGET; resolution commits on EXEC.

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

**Before push or deploy:** Cleanup is part of Step 4, not optional post-ship housekeeping. [/andx-execute-and-deploy](../andx-execute-and-deploy/SKILL.md) and [/andx-execute-review-and-deploy](../andx-execute-review-and-deploy/SKILL.md) must not start Phase A′ until cleanup evidence is logged — even if prod is still failing and the session continues debugging.

**Parallel waves** ([/andx-schedule](../andx-schedule/SKILL.md)): when EXEC-MATRIX present, parent cleans **each** `WORKTREE_DIR` from wave handoffs after integration merge. Subagents still never pre-merge cleanup.

### On fail

Do **not** merge partial work unless the user explicitly asks. **Do not** remove the worktree — leave it for inspection. Report `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, conflict paths, failing commands.

## Parent allowed actions

- Read files anywhere in repo
- Run read-only commands (tests, curl, git log/status) on primary checkout
- Create/remove worktrees, merge, checkout, commit **only** merge commits on `TARGET_BRANCH`
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

## Anti-patterns

- Parent patches source during orchestration (including editing the worktree inline when a subagent should run)
- Subagent merges to `TARGET_BRANCH` itself
- Subagent removes worktree before parent merge
- `move_agent_to_root` to `WORKTREE_DIR` (opens an extra Cursor workspace)
- "Done" on exec branch before parent merge
- Parent claims done without cleanup evidence (`git worktree list` before/after)
- Orphan `.worktrees/andx/exec-*` or ad-hoc `*-exec/` worktrees left after successful merge
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
- [/andx-pr-review](../andx-pr-review/SKILL.md)
