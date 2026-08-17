# Andx harness matrix

Cursor-primary. Claude best-effort. Same skills; degrade when an API is missing — never invent Task parameters.

Spawn details live here. Entry skills describe **roles + contracts** only.

## Worker (implement)

| Harness | Spawn |
|---------|--------|
| Cursor | `Task(subagent_type="generalPurpose")` in the **same** workspace as parent. Prompt: Shell `working_directory` / absolute paths = `WORKTREE_DIR`. Never `move_agent_to_root` to the worktree. |
| Claude | Same `generalPurpose` worker; instruct cwd in the prompt only |

Always use andx worktree vars from [SKILL.md](./SKILL.md) Step 1. Parent stays at `REPO_ROOT`. Parent merges to `TARGET_BRANCH` and cleans up.

**Out of default path:** `best-of-n-runner` and cloud `environment=cloud` — parallel experiments only. Do **not** use for default `/andx-execute` (own branch/worktree fights andx merge/`resume`/cleanup).

## Debug analyst (readonly)

| Harness | Spawn |
|---------|--------|
| Claude | `Task(subagent_type="generalPurpose", readonly=true)` when supported |
| Cursor | `generalPurpose` + prompt forbids edits (best-effort; no `readonly` flag) |

No worktree until analyst handoff `pass`. Do not resume analyst as execute worker.

## Reviewers (`/andx-execute-and-review`)

| Role | Cursor | Claude |
|------|--------|--------|
| Bugbot (always) | `Task(subagent_type="bugbot")` per `~/.cursor/skills-cursor/review-bugbot/SKILL.md` | Same intent via available Task type or skill invoke |
| Security (always) | `Task(subagent_type="security-review")` per `~/.cursor/skills-cursor/review-security/SKILL.md` | Same |
| Ponytail-review (always) | `generalPurpose` + [ponytail resolve](#ponytail-resolve) | Same |
| Ponytail-audit / react / a11y (conditional) | `generalPurpose` + skill path from [SKILL-MAP.md](./SKILL-MAP.md) | Same |

Fresh agents only — no shared worker context. Read-only: judge, do not edit app source.

## Ponytail resolve

Try in order; stop at first hit:

1. `~/.cursor/skills/ponytail-review/SKILL.md` (and `ponytail-audit`)
2. Newest `~/.claude/plugins/cache/ponytail/ponytail/*/skills/ponytail-review/SKILL.md` (and `ponytail-audit`)
3. Fail with: install ponytail plugin / symlink into `~/.cursor/skills/`

Never use `~/.cursor/skills-cursor/ponytail-*` (not shipped there).

## Evidence rule

No completion / “fixed” / “healthy” claim without **fresh command output in the current message** after the last relevant edit or deploy.
