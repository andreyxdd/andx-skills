# Agents

Read in order:

1. [IDENTITY.md](IDENTITY.md) — audience, constraints, non-goals, workstream/stack stubs
2. [ROUTING.md](ROUTING.md) — active ICM stage
3. [knowledge/index.md](knowledge/index.md) — OKF bundle entry
4. [knowledge/doc-sync-map.md](knowledge/doc-sync-map.md) — code → doc triggers

If the repo has `docs/README.md`, read it for ADRs, features, and diagrams.

## Andx flow

After planning: `/andx-plan` → Next menu → bare `go` runs default skill (usually `/andx-execute`) on that plan.

Skill routing / spawn: andx-orchestration `SKILL-MAP.md` + `HARNESS.md` (do not paste into this repo).

## Deploy

Production deploy policy lives in **this repo’s** docs (`docs/DEPLOY*`, `deploy/README.md`, Makefile, workflows) and `.cursor/rules/*deploy*`. Shared `/andx-deploy` **rediscovers** method + commands every run — do not cache prior-session deploy steps.

## Docs

Before done with doc edits: run project doc verifier if present (`pnpm verify:docs`, `npm run verify:docs`, or `node scripts/verify-docs.mjs`).
