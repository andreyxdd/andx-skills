# Agents

Read in order:

1. [IDENTITY.md](IDENTITY.md) — audience, constraints, non-goals, workstream/stack stubs
2. [ROUTING.md](ROUTING.md) — active ICM stage
3. [knowledge/index.md](knowledge/index.md) — OKF bundle entry

## Andx flow

After planning: `/andx-plan` → Next menu → bare `go` runs default skill (usually `/andx-execute`) on that plan.

Skill routing / spawn: andx-orchestration `SKILL-MAP.md` + `HARNESS.md` (do not paste into this repo).

## Deploy

Production deploy policy lives in **this repo’s** docs and `.cursor/rules/*deploy*`. Shared `/andx-deploy` **rediscovers** method + commands every run.

Default stack for this preset: `none` (not React). Prefer `workstream: docs` or `mixed` when plans are mostly catalog/docs.
