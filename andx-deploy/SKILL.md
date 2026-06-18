---
name: andx-deploy
description: Deploys the current revision to production and verifies health. Source hotfixes run in a subagent worktree and merge to the checked-out branch. Discovers deploy method from repo docs each run. Use for /andx-deploy, "deploy to production", or when code is already committed and only prod deploy plus health checks are needed.
---

# Andx Deploy

Ship the current revision to production and confirm the running system is healthy. No implementation phase unless deploy failure requires a code hotfix (subagent + worktree).

## When to use

- User invokes `/andx-deploy` or asks to deploy to production and verify health
- Code is already committed (and pushed if the repo uses remote-triggered deploy)
- User confirms which revision to ship when local and remote may differ

**Not for:** writing or testing new features — use `/andx-execute` or `/andx-execute-and-deploy`.

**Full implement + deploy** — use [/andx-execute-and-deploy](../andx-execute-and-deploy/SKILL.md).

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Hotfix loop only — worktree, subagent spawn, merge-back |

## Preflight

1. **Anchor revision** — `git rev-parse HEAD`, branch, clean/dirty status; note unpushed commits.
2. **Auto-push** — only when `git remote get-url origin` succeeds **and** deploy needs remote commits. Then `git push -u origin HEAD`. If no `origin`, skip push when deploy uses local tree. Do not ask for push confirmation unless the user forbade push. Never force-push `main`/`master` without explicit ask.
3. Proceed to Phase B below.

**Parent never edits application source** during deploy. Deploy commands and health checks only.

## Workflow

```
B. Discover deploy path (from repo docs — every run)
C. Deploy to production
D. Verify app running + deploy healthy
```

---

## Phase B — Discover how production deploy works

**Always read project context fresh** — do not cache deploy commands from a prior session.

| Look for | Typical signals |
|----------|-----------------|
| `deploy/README.md`, `docs/deploy*.md` | SSH host alias, `rsync`, `systemctl`, migrate/backup scripts |
| `.github/workflows/*.yml` | `workflow_dispatch`, deploy on `push` to `main` / `production` |
| `Dockerfile`, `fly.toml`, `render.yaml`, etc. | Platform CLI deploy |
| `package.json` / `Makefile` `deploy` scripts | Wrapped commands |

Classify **one primary path** for this repo:

- **SSH / VPS (required for pos-api)** — `git push` then `make deploy-build` and `make deploy DEPLOY_SKIP_ENV=1` per `docs/DEPLOY.md`. Also follow project rule `.cursor/rules/andx-deploy-ssh.mdc`.
- **GitHub Actions** — **disabled** in this repo (`*.yml.disabled`). Do **not** use `gh workflow run` or wait for Actions deploy.
- **Other** — follow documented commands exactly

For **pos-api**, always use **SSH / VPS**. If ambiguous on another repo, ask once.

Record before deploying:

- **Method** (ssh | gh-actions | other)
- **Commands** (from docs; only adapt documented host/path names)
- **Deploy success criterion** — falsifiable

---

## Phase C — Deploy to production

Run the documented production sequence. Use only what the repo documents.

### SSH / VPS

```bash
# Pattern — replace with deploy/README.md
rsync -avz --exclude .venv --exclude .git … ./ HOST:/opt/app/
ssh HOST 'cd /opt/app && … pip install … && backup-db && migrate && systemctl restart …'
```

Respect backup/migrate rules in docs.

### GitHub Actions

**Not used on pos-api** (workflows disabled). Use SSH deploy below.

Do not skip migration/backup steps the deploy doc requires.

**Scope guard:** Production only. No secrets in chat; use server-side env tooling.

---

## Phase D — Verify running and healthy

Run **fresh** checks after deploy (one falsifiable criterion each).

| Check | Example |
|-------|---------|
| HTTP health | `curl -sS https://<host>/health` → 200 |
| Processes | `ssh HOST 'systemctl is-active …'` → `active` |
| Revision | server `git rev-parse` or workflow `conclusion: success` |

Use the project **Health** section when present.

### Failure loop

```
FAIL → diagnose → plan fix + criterion
     → (if source change needed) orchestration + subagent hotfix
     → parent merge + verify on TARGET_BRANCH
     → re-deploy → re-verify
     (max 3 attempts per issue, then stop with blocker)
```

When the fix requires **application source changes**:

1. Parent runs [/andx-orchestration](../andx-orchestration/SKILL.md) Step 1 (always-on worktree).
2. Spawn subagent with minimal hotfix brief + deploy failure evidence. Subagent implements, verifies, commits on `EXEC_BRANCH`.
3. Parent: orchestration Step 4 — merge to `TARGET_BRANCH`, re-run focused tests on `TARGET_BRANCH`, **mandatory worktree cleanup** (`git worktree remove` + `branch -d` with evidence).
4. Parent re-deploys only after merge + verification + cleanup on `TARGET_BRANCH`.

Parent must **not** patch prod-blocking code inline during deploy.

Deploy-only completion does not require a worktree unless source changed.

Apply `fresh verification output in the current message before completion claims` before "deployed and healthy" claims.

## Progress tracking

```
Deploy (rev: abc1234):
- [x] Pushed to origin
- [x] Deploy commands completed
- [x] curl /health → 200
- [x] systemctl active
```

Hotfix path add:

```
- [x] Subagent hotfix passed on exec branch
- [x] Merged to target — tests passed
- [x] Re-deploy completed
```

## Evidence format

Per gate: **command**, **outcome**, **snippet**.

## Anti-patterns

- Guessing SSH host or workflow names
- Skipping backup/migrate when docs require them
- Health claims without fresh `curl` / `systemctl` output
- Parent patching source inline during deploy hotfix
- Deploy before merge + verification on `TARGET_BRANCH` when hotfix used
- Re-deploying from exec branch without merging to `TARGET_BRANCH`
- Leaving hotfix worktree after successful merge

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Implement then deploy | `/andx-execute-and-deploy` |
| Completion claims | `fresh verification output in the current message before completion claims` |
