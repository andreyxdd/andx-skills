---
name: andx-orchestration
description: Parent-orchestrator protocol for andx skills — always-on worktree isolation, subagent spawn contract, merge-back to checked-out branch, and handoff schema. Use when /andx-execute, /andx-execute-and-review, /andx-debug-and-fix, /andx-execute-and-deploy, or /andx-deploy spawns implementation work.
---

# Andx Orchestration

Shared protocol for **parent orchestrators**. The parent never edits application source; subagents implement in an isolated worktree and merge back to `TARGET_BRANCH`.

## Roles

| Role | Edits source? | Runs deploy/SSH? |
|------|---------------|------------------|
| **Parent orchestrator** | Never | Yes (deploy only) |
| **Subagent (worker)** | Yes — only inside worktree | No |

## Variables (record in every run)

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
TARGET_BRANCH=$(git branch --show-current)
EXEC_BRANCH="andx/exec-$(date +%Y%m%d-%H%M%S)"
WORKTREE_DIR="$REPO_ROOT/.worktrees/$EXEC_BRANCH"
```

State `REPO_ROOT`, `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR` in the reply before spawning.

## Step 1 — Always create worktree

Run **before any subagent spawn**, regardless of clean/dirty status. Do not edit the primary checkout.

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

Use `Task` with `subagent_type="generalPurpose"`. Include in the prompt:

- `WORKTREE_DIR`, `EXEC_BRANCH`, `TARGET_BRANCH`, `REPO_ROOT`
- Worker skill section to follow (e.g. andx-execute Worker, debug worker, deploy-hotfix worker)
- Anchored plan, verification table (or template), bug/deploy evidence
- Required companion skills: `/tdd`, `/impeccable` (UI only). Show fresh verification output before completion claims.
- **Return schema** (below)

```text
Task(
  subagent_type="generalPurpose",
  description="andx worker in worktree",
  prompt="..."
)
```

Resume the same subagent (`resume=<id>`) when continuing work in the same worktree (e.g. debug → execute). Spawn a new subagent only if the prior one failed hard or the worktree was torn down.

### Subagent workspace rules

- All shell commands and file edits use `WORKTREE_DIR` as cwd
- If `cursor-app-control` MCP is available: `move_agent_to_root({ rootPath: WORKTREE_DIR })` before first edit
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

## Step 4 — Merge back (always on pass)

After subagent reports pass and Phase 3 passed on `EXEC_BRANCH`:

```bash
cd "$REPO_ROOT"
git checkout "$TARGET_BRANCH"
git merge "$EXEC_BRANCH"    # resolve conflicts on TARGET_BRANCH if needed
```

**Re-run Phase 3** on `TARGET_BRANCH` (full regression + every verification-table row). Parent runs these gates — do not trust subagent-only evidence after merge.

### Cleanup (mandatory after post-merge Phase 3 passes)

Run from `REPO_ROOT` on `TARGET_BRANCH`. Quote fresh command output in the reply — not optional.

```bash
git worktree list
git worktree remove "$WORKTREE_DIR"   # skip only for same-checkout fallback
git branch -d "$EXEC_BRANCH"
git worktree list   # prove andx/exec-… entry gone
```

Skip `worktree remove` only when `WORKTREE_DIR="$REPO_ROOT"` (fallback). Still run `git branch -d "$EXEC_BRANCH"` when safe.

**Future parallel waves** (`/andx-schedule`): parent cleans **each** `WORKTREE_DIR` from wave handoffs after integration merge. Subagents still never pre-merge cleanup.

### On fail

Do **not** merge partial work unless the user explicitly asks. **Do not** remove the worktree — leave it for inspection. Report `TARGET_BRANCH`, `EXEC_BRANCH`, `WORKTREE_DIR`, conflict paths, failing commands.

## Parent allowed actions

- Read files anywhere in repo
- Run read-only commands (tests, curl, git log/status) on primary checkout
- Create/remove worktrees, merge, checkout, commit **only** merge commits on `TARGET_BRANCH`
- Deploy commands (SSH, make deploy, health checks)
- Write plans, verification tables, progress updates in chat

## Parent forbidden actions

- `StrReplace` / `Write` on application source, tests, migrations, or config in primary checkout
- Claiming "done" before merge + post-merge Phase 3 on `TARGET_BRANCH`
- Reusing stale subagent output without fresh post-merge gates
- Skipping worktree because the tree is clean

## Anti-patterns

- Parent patches source during orchestration
- Subagent merges to `TARGET_BRANCH` itself
- Subagent removes worktree before parent merge
- "Done" on exec branch before parent merge
- Parent claims done without cleanup evidence (`git worktree list` before/after)
- Orphan `.worktrees/andx/exec-*` left after successful run
- Deploy before merge + post-merge verify when code changed

## Referenced by

- [/andx-plan](../andx-plan/SKILL.md) — produces `.cursor/plans/*.plan.md` this stack consumes
- [/andx-execute](../andx-execute/SKILL.md) — Orchestrator + Worker
- [/andx-execute-and-review](../andx-execute-and-review/SKILL.md)
- [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md)
- [/andx-execute-and-deploy](../andx-execute-and-deploy/SKILL.md)
- [/andx-deploy](../andx-deploy/SKILL.md) — hotfix loop only
