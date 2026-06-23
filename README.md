# andx-skills

Canonical **andx** agent skills for Cursor (primary) and Claude Code (symlinked).

## Skills

| Skill | Purpose |
|-------|---------|
| `andx-init` | Scaffold OKF + ICM layout (presets: app, data, content) |
| `andx-plan` | Grill + write `<repo>/.cursor/plans/*.plan.md` |
| `andx-execute` | Worktree execution + TDD + merge |
| `andx-execute-and-review` | Execute + adversarial review gate |
| `andx-execute-and-deploy` | Execute + push + deploy |
| `andx-debug-and-fix` | Readonly debug-like-expert analysis → execute worker |
| `andx-deploy` | Deploy + health check |
| `andx-orchestration` | Shared parent/worktree protocol |

## Hybrid layout (OKF + ICM)

Target repos can use a **hybrid** structure scaffolded by `/andx-init`:

| Layer | Paths | Role |
|-------|-------|------|
| **OKF** | `IDENTITY.md`, `knowledge/` | Who/what/why — glossary, APIs, datasets, voice, etc. |
| **ICM** | `ROUTING.md`, `pipeline/<stage>/` | Where work happens — stage CONTEXT + ephemeral `output/` |

**Presets:** `app` (software), `data` (analytics/ETL), `content` (editorial). Each preset ships pipeline stages and knowledge subtrees suited to that domain.

**Git policy:**

- Commit scaffold skeleton (`IDENTITY`, `ROUTING`, `knowledge/`, `pipeline/*/CONTEXT.md`).
- Gitignore ephemeral dirs: `pipeline/*/output/`, `.cursor/plans/`.
- Re-run scaffold is **additive** — never overwrites existing files.

Run once on a new or brownfield repo before `/andx-plan`:

```bash
andx-init/scripts/scaffold.sh app /path/to/repo
```

## Install

```bash
./install.sh
```

Symlinks each skill into:

- `~/.cursor/skills/` (Cursor — primary)
- `~/.claude/skills/` (Claude Code — same files)

## Edit workflow

1. Change files **only** in this repo (`~/Dev/tools/andx-skills/`).
2. Do not edit the symlink targets under `~/.cursor/skills/andx-*` directly.
3. Re-run `./install.sh` after pulling updates (safe to re-run).

## Conventions (Cursor-primary)

- Plans: **project-local** `.cursor/plans/<slug>.plan.md` only — never `~/.cursor/plans`.
- Before planning/executing: `move_agent_to_root` when workspace ≠ target repo.
- Companion skills live in each tool's skills dir (`grill-with-docs`, `tdd`, `impeccable`, `review`, etc.) — not bundled here.

## Companion skills (install separately)

Required for full andx flows in `~/.cursor/skills/`:

- `grill-with-docs`, `grill-me`
- `tdd`, `review`, `security-review`
- `impeccable` (UI steps in execute)
- `caveman-commit` (optional)
