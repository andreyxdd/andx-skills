---
name: andx-execute-and-deploy
description: Runs /andx-execute orchestrator (subagent in always-on worktree, merge to checked-out branch), auto-pushes TARGET_BRANCH when origin exists, then /andx-deploy. Use for /andx-execute-and-deploy or "execute and deploy".
---

# Andx Execute and Deploy

Implement via subagent in a worktree, merge and verify on `TARGET_BRANCH`, auto-push when `origin` exists, then deploy and confirm production health.

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
A.  Parent: /andx-execute Orchestrator (subagent worker + merge-back)
A′. Parent: auto-push to remote
B–D Parent: /andx-deploy (no subagent unless hotfix)
```

---

## Phase A — Execute

Follow [/andx-execute](../andx-execute/SKILL.md) **§ Orchestrator** through **Definition of done**:

- Always-on worktree via [/andx-orchestration](../andx-orchestration/SKILL.md)
- Subagent runs **§ Worker** Phases 0–4
- Parent merge + post-merge Phase 3 on `TARGET_BRANCH`

Do not start deploy until execute is fully complete on **`TARGET_BRANCH`**. Quote execute evidence (subagent handoff + post-merge gates) before deploying.

---

## Phase A′ — Auto-push

From **`REPO_ROOT` on `TARGET_BRANCH`** (after merge), push **only if** `origin` exists (unless the user forbade push in this thread):

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
Execute (target: main):
- [x] Worktree created
- [x] Subagent exec passed
- [x] Merged to target — post-merge regression passed
- [x] Pushed origin (or skipped — no origin)

Deploy: (see andx-deploy checklist)
```

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Plan missing depends/touch/verification | `/andx-plan` |
| Deploy only | `/andx-deploy` |
| Implementation only | `/andx-execute` |
| Bug first | `/andx-debug-and-fix` |
| Completion claims | `fresh verification output in the current message before completion claims` |
