---
name: andx-deploy
description: "/andx-deploy: deploy the committed revision to production using this repo's documented method, then verify health. Use for \"deploy to production\"."
disable-model-invocation: true
---
# Andx Deploy

Ship current revision; confirm healthy. Hotfixes only via orchestration worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Hotfix: [/andx-orchestration](../andx-orchestration/SKILL.md)

## When

Code committed; need prod deploy + health. Features → `/andx-execute` / `/andx-execute-and-deploy` / `/andx-execute-review-and-deploy`. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md).

## Preflight

Entered from `/andx-execute-and-deploy` or `/andx-execute-review-and-deploy` (Phase A′): start only after their cleanup evidence is quoted, from `REPO_ROOT` on `TARGET_BRANCH`, and always push in step 2 (no origin → skip and note it). The run still holds the ship queue lock (orch Step 4): `ship-queue.mjs heartbeat "$EXEC_BRANCH" --repo "$REPO_ROOT"` before push, deploy, and health.

1. Anchor: `git rev-parse HEAD`, branch, dirty/unpushed.
2. Push when `origin` exists **and** deploy needs remote: `git remote get-url origin && git push -u origin HEAD`. Force-push of main/master only on explicit ask. Push failed and deploy needs remote → fix before deploying.
3. Parent: deploy commands + health only — never edit app source.
4. **Migration gate:** if this revision touches goose/EF migrations, `WithAllowMissing`, or `DB_MIGRATIONS_ALLOW_MISSING`, load workspace `agents/rules/goose-migration-review-gates.md` (when present). Unconditional AllowMissing or gap-ordered migrations → **block deploy** until fixed (GitOps still via workspace gitops rule). Do not fork gate text here.

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

Entered from a composer: after fresh health output, `ship-queue.mjs release "$EXEC_BRANCH" --repo "$REPO_ROOT"` (the next queued run lands only now).

### Failure loop

```
FAIL → diagnose → (source fix?) orchestration worktree worker
     → orch Step 4 concurrent-merge + post-merge verify + cleanup → re-deploy
     (max 3; then stop with blocker)
```

The hotfix merge reuses the held lock (no `join`/`wait`). After the third failure, from a composer: `ship-queue.mjs halt "$EXEC_BRANCH" --repo "$REPO_ROOT" --reason "<blocker>"` instead of `release`, ledger `terminal: AWAITING_USER`. Queued runs stop with `HALTED`; the user runs `ship-queue.mjs resume` once HEAD is healthy.

Parent never patches source inline.

## Anti-patterns

- Guessing host/workflow from another repo
- Skipping required backup/migrate
- Health claims without fresh output
- Re-deploy from `EXEC_BRANCH` without merge to `TARGET_BRANCH`
- Leaving hotfix worktree after merge
