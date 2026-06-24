---
name: andx-init
description: Scaffold OKF + ICM hybrid layout into a target repo — IDENTITY, ROUTING, knowledge bundle, pipeline stages. Presets app, data, content. Additive only (never overwrite). Use for /andx-init or before /andx-plan when knowledge/ is missing.
---

# Andx Init

Bootstrap **OKF** (knowledge bundle) + **ICM** (pipeline stages) into a project repo. All writes are **additive** — existing files are never overwritten.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When to use

- User invokes `/andx-init` or asks to scaffold OKF/ICM layout
- `/andx-plan` Phase 0 finds no `knowledge/` directory
- New repo or brownfield repo needing structured agent context

**Not for:** planning features, executing code, or deploying.

## Presets

| Preset | Pipeline stages | Knowledge subtrees |
|--------|-----------------|-------------------|
| `app` | 01-discover → 04-verify | `domain/`, `apis/`, `modules/`, `runbooks/` |
| `data` | 01-catalog → 04-validate | `datasets/`, `tables/`, `metrics/` |
| `content` | 01-research → 04-publish | `topics/`, `audience/`, `voice/` |

All presets create:

- `IDENTITY.md` — audience, constraints, non-goals
- `ROUTING.md` — active pipeline stage pointer
- `knowledge/index.md`, `knowledge/log.md`, `knowledge/domain/glossary.md`
- `pipeline/<stage>/CONTEXT.md` (Inputs / Process / Outputs)
- `pipeline/<stage>/output/` (gitignored)
- `.cursor/plans/` directory
- `.gitignore` lines: `pipeline/*/output/`, `.cursor/plans/`

## Workflow

1. **Confirm target repo** — workspace root must be the project. Use `move_agent_to_root` if needed.
2. **Choose preset** — `app` (default for software), `data`, or `content`. Ask once if unclear.
3. **Run scaffold** — from this repo's canonical script:

```bash
/path/to/andx-skills/andx-init/scripts/scaffold.sh <preset> <repo_root>
```

Or when `andx-init` is installed via `./install.sh`:

```bash
"$(dirname "$(readlink -f ~/.cursor/skills/andx-init 2>/dev/null || echo .)")/scripts/scaffold.sh" <preset> <repo_root>
```

4. **Report** — list created vs skipped paths; remind user to fill `IDENTITY.md` and glossary.
5. **Next** — `/andx-plan` on the target repo.

## Brownfield policy

- Existing files → **skip** (logged as `skip (exists): …`)
- Missing dirs/files → create
- `.gitignore` → append lines only if absent

## Git policy

- Scaffold output is **committed by default** (IDENTITY, ROUTING, knowledge skeleton, pipeline CONTEXT).
- `pipeline/*/output/` and `.cursor/plans/` stay **gitignored** (ephemeral artifacts).
- Re-run scaffold safely on repos that already have partial layout.

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-plan](../andx-plan/SKILL.md) | Domain grill + plans after init |
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Execution protocol |

## Anti-patterns

- Overwriting user-edited IDENTITY or glossary
- Running scaffold from home directory without a target path
- Skipping preset choice on ambiguous projects (ask once)
- Putting implementation details in pipeline CONTEXT (keep Inputs/Process/Outputs at stage level)
