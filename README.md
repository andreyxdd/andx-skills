# andx-skills

Canonical **andx** agent skills for Cursor (primary) and Claude Code (symlinked). Claude = best-effort when Task APIs differ — see [andx-orchestration/HARNESS.md](./andx-orchestration/HARNESS.md).

## Skills

| Skill | Purpose |
|-------|---------|
| `andx-init` | Scaffold OKF + ICM layout (presets: app, data, content) |
| `andx-plan` | Grill + write `<repo>/.cursor/plans/*.plan.md`; Next menu + `go` |
| `andx-schedule` | Build EXEC-MATRIX waves from depends+touch; enable parallel execute |
| `andx-execute` | Worktree execution + TDD + merge |
| `andx-execute-and-review` | Execute + adversarial review gate |
| `andx-execute-and-deploy` | Execute + push + deploy |
| `andx-execute-review-and-deploy` | Execute + review gate + push + deploy |
| `andx-debug-and-fix` | Readonly debug analysis → execute worker |
| `andx-deploy` | Deploy + health check (discover from **this** repo) |
| `andx-deploy-init` | First-time CI/CD grill, checklist, review-gated plan |
| `andx-mr-review` | Remote MR review + comment posting |
| `andx-mr-babysit` | Remote MR/PR merge-ready loop (conflicts/comments/CI) |
| `andx-orchestration` | Shared parent/worktree protocol + SKILL-MAP + HARNESS |

## Single sources of truth

| File | Owns |
|------|------|
| `andx-orchestration/SKILL.md` | Worktree, spawn checklist, handoff, merge, cleanup |
| `andx-orchestration/HARNESS.md` | Cursor vs Claude Task mapping |
| `andx-orchestration/SKILL-MAP.md` | Companion + reviewer routing |
| `andx-plan/PLAN-FORMAT.md` | Plan frontmatter + parse rules |

Entry skills stay thin — link here; do not re-paste cleanup bash or reviewer tables.

**No project names in shared skills** — deploy policy lives in each repo’s docs / `.cursor/rules/*deploy*`.

## Hybrid layout (OKF + ICM)

| Layer | Paths | Role |
|-------|-------|------|
| **OKF** | `IDENTITY.md`, `knowledge/` | Who/what/why; IDENTITY holds `workstream` / `stack` stubs |
| **ICM** | `ROUTING.md`, `pipeline/<stage>/` | Where work happens |
| **Agents** | `AGENTS.md` | Slim entry: read order, `/andx-plan` → Next → `go`, HARNESS/SKILL-MAP pointer, deploy rediscovery |

Presets: `app` | `data` | `content`. Scaffold **additive** (never overwrite); gitignore `pipeline/*/output/`, `.cursor/plans/`.

- `app`: may hint `stack: react-next`; includes `knowledge/doc-sync-map.md`
- `data` / `content`: default `stack: none` (no React forced)

Gap inventory: [andx-init/templates/CHANGELOG-notes.md](./andx-init/templates/CHANGELOG-notes.md).

```bash
andx-init/scripts/scaffold.sh app /path/to/repo
```

## Install

```bash
./install.sh
./install-companions.sh   # optional; React/Next companions
```

Symlinks into `~/.cursor/skills/`, `~/.claude/skills/`, and `~/.codex/skills/`.

## Edit workflow

1. Edit only this repo (`~/Dev/tools/andx-skills/`).
2. Re-run `./install.sh` after pull/change.

## Conventions (Cursor-primary)

- Plans: project-local `.cursor/plans/` only.
- Worktrees: `$REPO_ROOT/.worktrees/exec-<slug>-<stamp>` (orch slug naming).
- `move_agent_to_root` only when workspace ≠ target **project** (`/andx-plan`, `/andx-init`). Never for exec worktrees — worker uses `WORKTREE_DIR` as tool cwd in the same workspace.
- Flow: `/andx-plan` → optional `/andx-schedule` (multi-wave) → `/andx-execute` (or execute-and-review / execute-and-deploy / execute-review-and-deploy).
- After `/andx-plan`: Next menu; bare `go` runs default skill on that plan.
- Companions (`grill-with-docs`, `tdd`, `impeccable`, …) install separately.
- Ponytail: resolve via HARNESS (not `skills-cursor/`).

## Companion skills

Required for full flows: `grill-with-docs`, `grill-me`, `tdd`, `impeccable`, Cursor `review-bugbot` / `review-security`.

**React/Next:** `react-best-practices` via `./install-companions.sh` — wired when `REACT_STACK` / plan `stack: react-next`.
