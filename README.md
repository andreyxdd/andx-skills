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
| `andx-plan/PLAN-FORMAT.md`, `PARSE.md` | Plan templates; frontmatter + parse rules |

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
- After `/andx-plan`: Next menu. Recommended: open a fresh chat (Claude Code: `/clear`) and paste its `Fresh chat: /andx-<default> <abs plan path>` line, so execution requests do not carry the grill transcript. Fallback: bare `go` runs the default skill in the same thread, grill context included.
- Companions (`grilling`, `tdd`, `impeccable`, …): `./install-companions.sh` (Matt Pocock skills pinned clone + react-best-practices).
- Ponytail: resolve via HARNESS (not `skills-cursor/`).

## Recommended harness settings

- Claude Code ≥ 2.1.312: older versions ignore the agents' `autoCompactWindow: 200000` when it is lower than the session window.
- `export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` (shell profile): caps parent context before compaction; without it a 1M-context model grows toward 1M and every request pays for it.
- Frontmatter already sets `effort: medium` on the orchestrator skills and the spec reviewer; the worker, security reviewer, and refuter inherit the session model and effort. `ruby scripts/check_skills.rb` rejects frontmatter keys neither Cursor nor Claude Code documents.

## Spend baseline

`ruby scripts/spend_report.rb --summary ~/.claude/projects` (2026-10-29, 90 Claude Code runs that invoke an andx skill; input = uncached + cache write + cache read):

| Median per run (all skills) | Value |
|-----------------------------|-------|
| Input tokens, total | 77,809,198 |
| Input tokens, parent | 24,218,974 |
| Input tokens, subagents | 13,283,361 |
| Requests, parent | 121 |
| Requests, subagents | 134 |
| Output tokens | 141,287 |
| Peak parent context | 339,894 |
| Image tool results | 0 |

Each median is taken independently per metric, so parent + subagents does not add up to total.

Per first-invoked skill (a run is grouped by the first andx skill its parent session invokes):

| Skill | Runs | Median input total | Median output |
|-------|------|--------------------|---------------|
| `andx-plan` | 53 | 148,150,580 | 249,269 |
| `andx-mr-review` | 27 | 14,612,676 | 32,919 |
| `andx-init` | 5 | 46,668,385 | 179,398 |
| `andx-execute` | 3 | 130,779,762 | 207,083 |
| `andx-debug-and-fix` | 1 | 25,153,371 | 74,919 |
| `andx-execute-and-deploy` | 1 | 3,972,369 | 19,151 |

**Target:** −40% per-skill median input total over the next 10 runs of each skill, judged primarily on the `andx-execute*` skills; compare a skill only with its own baseline row. Caveat: most baseline execution ran in the planning thread (`go`), so it sits in the `andx-plan` row. After a fresh-chat handoff, add each feature's plan-run and execute-run input totals, and compare the median of those sums with the `andx-plan` baseline; a falling `andx-plan` row alone only shows execution moving out. Per-run detail: `ruby scripts/spend_report.rb <session.jsonl|dir>`.

## Companion skills

Required for full flows: `grilling`, `tdd`, `codebase-design`, `impeccable`, Cursor `review-bugbot` / `review-security`.

**React/Next:** `react-best-practices` via `./install-companions.sh` — wired when `REACT_STACK` / plan `stack: react-next`.
