# andx-skills

Canonical **andx** agent skills for Cursor (primary) and Claude Code (symlinked).

## Skills

| Skill | Purpose |
|-------|---------|
| `andx-plan` | Grill + write `<repo>/.cursor/plans/*.plan.md` |
| `andx-execute` | Worktree execution + TDD + merge |
| `andx-execute-and-review` | Execute + adversarial review gate |
| `andx-execute-and-deploy` | Execute + push + deploy |
| `andx-debug-and-fix` | Debug worktree + fix loop |
| `andx-deploy` | Deploy + health check |
| `andx-orchestration` | Shared parent/worktree protocol |

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
