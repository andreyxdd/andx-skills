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

Entered with `--deploy` (or its aliases): start only after its cleanup evidence is quoted, from `REPO_ROOT` on `TARGET_BRANCH`; push per step 2, then `run.mjs phase "$SLUG" A′`. It still holds the ship-queue lock `SHIP_ID`: `ship-queue.mjs heartbeat "$SHIP_ID"` around each push, CI watch, deploy, and health check.

1. Anchor: `git rev-parse HEAD`, branch, dirty/unpushed.
2. Push unless `PUSH_POLICY=disabled` or no `origin` (note it): `git push -u origin HEAD`; force-push of main/master only on explicit ask; a failed push the deploy needs → fix first.
3. Parent: deploy commands + health only; never edit app source.
4. **Migration gate:** goose/EF migrations, `WithAllowMissing` or `DB_MIGRATIONS_ALLOW_MISSING` touched → apply workspace `agents/rules/goose-migration-review-gates.md` when present; unconditional AllowMissing or gap-ordered migrations block deploy. `--deploy` run: `ship-queue.mjs halt "$SHIP_ID" --reason "<gate>"`, end `AWAITING_USER`.

## Phase B — Discover (every run)

Read this repo fresh; never cache prior-session commands. If unclear, read `~/.agents/skills/github-workflows/SKILL.md`.

| Look for | Signals |
|----------|---------|
| `docs/DEPLOY*`, `deploy/README.md` | SSH, rsync, systemctl, make targets |
| `.github/workflows/*.yml` | push/`workflow_dispatch` deploy |
| `Dockerfile`, `fly.toml`, `render.yaml` | Platform CLI |
| `Makefile` / `package.json` deploy scripts | Wrapped commands |
| `.cursor/rules/*deploy*` | Project-local deploy policy |

Classify one primary method: `ssh` | `gh-actions` | `other`. If ambiguous, ask once. Record **Method**, **Commands** (from docs), **Deploy success criterion** (falsifiable), then `run.mjs phase "$SLUG" B` (ledger calls: `--deploy` runs only).

## Phase C — Deploy

Run documented production sequence only. Respect backup/migrate rules. No secrets in chat. Then `run.mjs phase "$SLUG" C`.

## Phase D — Verify

Fresh health/process/revision checks ([HARNESS.md](../andx-orchestration/HARNESS.md) evidence rule) and **every** plan acceptance item: `run.mjs check "$SLUG" <id> --kind auto|manual --status PASS|FAIL|PENDING --evidence "<line>"`; human-only flows stay `manual PENDING` until the user confirms. All PASS → `run.mjs phase "$SLUG" D`, then (`--deploy`) `ship-queue.mjs release "$SHIP_ID" --after-deploy`, end with `--deployed PASS`. Only manual pending → release, end `AWAITING_USER --deployed PENDING`; once confirmed, re-record PASS, phase `D`, end. Re-deploy → re-record all.

### Failure loop

FAIL → diagnose → source fix: hotfix worker in a new worktree → ff land, post-merge verify, cleanup → re-deploy; max 3. The hotfix keeps `SHIP_ID` and the held lock (no `announce`/`join`/`wait`; orch Step 4 item 4). Any stop here: `ship-queue.mjs halt "$SHIP_ID" --reason "<blocker>"`, end `AWAITING_USER`.

## Anti-patterns

- Guessing host/workflow from another repo
- Skipping required backup/migrate
- Health claims without fresh output, or standing in for acceptance items
- Re-deploy from `EXEC_BRANCH` without landing on `TARGET_BRANCH`
- Leaving the hotfix worktree after landing
