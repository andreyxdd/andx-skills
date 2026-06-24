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
./install-companions.sh   # optional; React/Next companion skills
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

Run `./install-companions.sh` after `./install.sh` for bundled companion installers, or install manually.

Required for full andx flows in `~/.cursor/skills/`:

- `grill-with-docs`, `grill-me`
- `tdd`, `review`, `security-review`
- `impeccable` (UI steps in execute)
- `caveman-commit` (optional)

**React/Next projects** — installed by `./install-companions.sh`:

- [`react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) — Vercel perf rules; auto-wired into `/andx-execute` worker when `REACT_STACK` is detected (see `andx-execute` preflight) and as a conditional reviewer in `/andx-execute-and-review`. Plan frontmatter `stack: react-next` (or `react` / `next`) forces it on; `stack: none` disables.
