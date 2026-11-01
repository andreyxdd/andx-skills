---
name: andx-deploy
description: "/andx-deploy: deploy the committed revision to production using this repo's documented method, then verify health. Use for \"deploy to production\"."
disable-model-invocation: true
---
# Andx Deploy

Ship current revision; confirm healthy. Hotfixes only via orchestration worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Hotfix: [/andx-orchestration](../andx-orchestration/SKILL.md)

## When

Code committed; need prod deploy + health. Features → `/andx-execute --deploy` / `/andx-execute-and-review --deploy`. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md).

## Preflight (Phase A′)

Entered with `--deploy` (or its aliases): start only after its cleanup evidence is quoted, from `REPO_ROOT` on `TARGET_BRANCH`; always push in step 2 (no origin → skip, note it), then `run.mjs phase "$SLUG" A′`. It still holds the ship-queue lock `SHIP_ID`: `ship-queue.mjs heartbeat "$SHIP_ID"` around each push, CI watch, deploy, and health check.

1. Anchor: `git rev-parse HEAD`, branch, dirty/unpushed.
2. Push when `origin` exists **and** deploy needs remote: `git remote get-url origin && git push -u origin HEAD`. Force-push of main/master only on explicit ask. Push failed and deploy needs remote → fix first.
3. Parent: deploy commands + health only; never edit app source.
4. **Migration gate:** if this revision touches goose/EF migrations, `WithAllowMissing`, or `DB_MIGRATIONS_ALLOW_MISSING`, load workspace `agents/rules/goose-migration-review-gates.md` (when present). Unconditional AllowMissing or gap-ordered migrations → **block deploy** until fixed (GitOps still via workspace gitops rule). Do not fork gate text here. In a `--deploy` run this is a stop after landing: `ship-queue.mjs halt "$SHIP_ID" --reason "<gate>"`, end `AWAITING_USER`.

## Phase B — Discover (every run)

Read this repo fresh; never cache prior-session commands. If unclear, read `~/.cursor/skills/github-workflows/SKILL.md`.

| Look for | Signals |
|----------|---------|
| `docs/DEPLOY*`, `deploy/README.md` | SSH, rsync, systemctl, make targets |
| `.github/workflows/*.yml` | push/`workflow_dispatch` deploy |
| `Dockerfile`, `fly.toml`, `render.yaml` | Platform CLI |
| `Makefile` / `package.json` deploy scripts | Wrapped commands |
| `.cursor/rules/*deploy*` | Project-local deploy policy |

Classify one primary method: `ssh` | `gh-actions` | `other`. If ambiguous, ask once. Record **Method**, **Commands** (from docs), **Deploy success criterion** (falsifiable), then `run.mjs phase "$SLUG" B` (`run.mjs phase` calls: `--deploy` runs only; standalone `/andx-deploy` keeps no ledger).

## Phase C — Deploy

Run documented production sequence only. Respect backup/migrate rules. No secrets in chat. Then `run.mjs phase "$SLUG" C`.

## Phase D — Verify

Fresh checks after deploy (HTTP health, process active, revision). Evidence rule: [HARNESS.md](../andx-orchestration/HARNESS.md). Healthy → `run.mjs phase "$SLUG" D`; in a `--deploy` run, `ship-queue.mjs release "$SHIP_ID" --after-deploy` (next queued run lands now).

### Failure loop

```
FAIL → diagnose → (source fix?) hotfix worker in a new worktree
     → ff land + post-merge verify + cleanup → re-deploy
     (max 3; then stop with blocker)
```

The hotfix keeps `SHIP_ID` and the held lock (no `announce`/`join`/`wait`) and lands as a fix after landing (orch Step 4 item 4). A `--deploy` run already landed, so any stop in this loop is `ship-queue.mjs halt "$SHIP_ID" --reason "<blocker>"` (rules: `ship-queue.mjs --help`), end `AWAITING_USER`.

## Anti-patterns

- Guessing host/workflow from another repo
- Skipping required backup/migrate
- Health claims without fresh output
- Re-deploy from `EXEC_BRANCH` without landing on `TARGET_BRANCH`
- Leaving the hotfix worktree after landing
