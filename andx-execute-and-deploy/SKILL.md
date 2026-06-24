---
name: andx-execute-and-deploy
description: Runs /andx-execute orchestrator (subagent in always-on worktree, merge to checked-out branch), auto-pushes TARGET_BRANCH when origin exists, then /andx-deploy. Use for /andx-execute-and-deploy or "execute and deploy".
---

# Andx Execute and Deploy

Implement via subagent in a worktree, merge and verify on `TARGET_BRANCH`, auto-push when `origin` exists, then deploy and confirm production health.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When to use

- User invokes `/andx-execute-and-deploy` or asks to execute a plan **and** deploy to production
- Plan is ready (or supplied in the same thread)

**Not for:** local-only work, staging-only (unless named), or deploy without implementation in this run.

| Need | Skill |
|------|--------|
| Deploy only (code already done) | [/andx-deploy](../andx-deploy/SKILL.md) |
| Debug then ship | `/andx-debug-and-fix` then this skill or `/andx-deploy` |
| Implement only | `/andx-execute` |

## Workflow overview

```
A.   Parent: /andx-execute Orchestrator (subagent worker + merge-back + worktree cleanup)
A′.  Parent: auto-push to remote
B–D  Parent: /andx-deploy (no subagent unless hotfix)
```

**Gate:** Phase A′ and B–D start only after Phase A **Definition of done** — including worktree removal and `EXEC_BRANCH` delete with logged `git worktree list` evidence. Push/deploy after merge alone is **not** execute-complete.

---

## Phase A — Execute

Follow [/andx-execute](../andx-execute/SKILL.md) **§ Orchestrator** through **Definition of done** (all must pass):

- Always-on worktree via [/andx-orchestration](../andx-orchestration/SKILL.md) — use `$REPO_ROOT/.worktrees/$EXEC_BRANCH`, not ad-hoc sibling dirs (e.g. `*-exec/`)
- Subagent runs **§ Worker** Phases 0–4 (spawn `Task`; parent must not edit application source in the worktree)
- Parent merge + post-merge Phase 3 on `TARGET_BRANCH`
- **Cleanup** per orchestration Step 4 — mandatory before Phase A′:

```bash
git worktree list
git worktree remove "$WORKTREE_DIR"   # skip only for same-checkout fallback
git branch -d "$EXEC_BRANCH"
git worktree list   # prove exec worktree entry gone
```

Do not start **push or deploy** until execute is fully complete on **`TARGET_BRANCH`** **and** cleanup evidence is quoted. Quote subagent handoff + post-merge gates + cleanup output before deploying.

If prod debugging starts after merge, **still run cleanup first** — do not defer because a follow-up bug appeared.

---

## Phase A′ — Auto-push

From **`REPO_ROOT` on `TARGET_BRANCH`** (after merge **and** Phase A cleanup), push **only if** `origin` exists (unless the user forbade push in this thread):

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout "$TARGET_BRANCH"
git remote get-url origin   # exit 0 → origin exists; else skip push
git push -u origin HEAD
```

- **No `origin`** — skip push; note in progress (`no remote origin`). Continue to deploy if deploy uses local tree (e.g. SSH/rsync).
- Do not ask for push confirmation when pushing.
- Never force-push `main`/`master` without explicit user ask.
- If push fails, diagnose (auth, branch protection), fix, retry — do not deploy unpushed code when deploy depends on remote.

---

## Phases B–D — Deploy

Follow [/andx-deploy](../andx-deploy/SKILL.md) from **Preflight** through **Phase D**.

**pos-api:** GitHub Actions deploy is **off**. After push: `make deploy-build` then `make deploy DEPLOY_SKIP_ENV=1` over SSH (see `docs/DEPLOY.md` and `.cursor/rules/andx-deploy-ssh.mdc`). Do **not** use `gh workflow run` or wait for Actions.

Deploy discovery is **always from current repo context** — never from memory of a prior project.

Deploy hotfixes that change source → subagent + worktree per andx-deploy failure loop; parent never edits source inline.

---

## Progress tracking

```
Execute (target: main; exec: andx/exec-…):
- [x] Worktree created ($WORKTREE_DIR under .worktrees/)
- [x] Subagent handoff — pass
- [x] Merged to target — post-merge Phase 3 passed
- [x] Worktree cleaned — `git worktree list` before/after; `git branch -d $EXEC_BRANCH`
- [x] Pushed origin (or skipped — no origin)

Deploy: (see andx-deploy checklist)
```

Do not check **Pushed origin** or start deploy until **Worktree cleaned** is checked with fresh command output.

## Anti-patterns

- Push or deploy after merge but before worktree cleanup
- Parent edits worktree inline instead of spawning subagent worker
- Ad-hoc worktree path (`marketeye-api-exec/`, `*-exec/`) instead of `.worktrees/$EXEC_BRANCH`
- Treating "merged + pushed + deployed" as done when `git worktree list` still shows the exec entry
- Deferring cleanup because prod debugging continued in the same session

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Plan missing depends/touch/verification | `/andx-plan` |
| Deploy only | `/andx-deploy` |
| Implementation only | `/andx-execute` |
| Bug first | `/andx-debug-and-fix` |
| Completion claims | `fresh verification output in the current message before completion claims` |
