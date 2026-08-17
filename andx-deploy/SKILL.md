---
name: andx-deploy
description: Deploys the current revision to production and verifies health. Source hotfixes run in a subagent worktree and merge to the checked-out branch. Discovers deploy method from repo docs each run. Use for /andx-deploy, "deploy to production", or when code is already committed and only prod deploy plus health checks are needed.
---

# Andx Deploy

Ship current revision; confirm healthy. Hotfixes only via orchestration worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Hotfix: [/andx-orchestration](../andx-orchestration/SKILL.md)

## When

Code committed; need prod deploy + health. Features → `/andx-execute` / `/andx-execute-and-deploy` / `/andx-execute-review-and-deploy`. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md).

## Preflight

1. Anchor: `git rev-parse HEAD`, branch, dirty/unpushed.
2. Auto-push when `origin` exists **and** deploy needs remote: `git push -u origin HEAD` (no force main/master without ask).
3. Parent: deploy commands + health only — never edit app source.

## Phase B — Discover (every run)

Read this repo fresh — do not cache prior-session commands. If unclear, read `~/.cursor/skills/github-workflows/SKILL.md`.

| Look for | Signals |
|----------|---------|
| `docs/DEPLOY*`, `deploy/README.md` | SSH, rsync, systemctl, make targets |
| `.github/workflows/*.yml` | push/`workflow_dispatch` deploy |
| `Dockerfile`, `fly.toml`, `render.yaml` | Platform CLI |
| `Makefile` / `package.json` deploy scripts | Wrapped commands |
| `.cursor/rules/*deploy*` | Project-local deploy policy |

Classify one primary method: `ssh` | `gh-actions` | `other`. If ambiguous, ask once.

Record: **Method**, **Commands** (from docs), **Deploy success criterion** (falsifiable).

## Phase C — Deploy

Run documented production sequence only. Respect backup/migrate rules. No secrets in chat.

## Phase D — Verify

Fresh checks after deploy (HTTP health, process active, revision). Evidence rule: [HARNESS.md](../andx-orchestration/HARNESS.md).

### Failure loop

```
FAIL → diagnose → (source fix?) orchestration worktree worker
     → orch Step 4 concurrent-merge + post-merge verify + cleanup → re-deploy
     (max 3; then stop with blocker)
```

Parent never patches source inline.

## Anti-patterns

- Guessing host/workflow from another repo
- Skipping required backup/migrate
- Health claims without fresh output
- Re-deploy from `EXEC_BRANCH` without merge to `TARGET_BRANCH`
- Leaving hotfix worktree after merge
