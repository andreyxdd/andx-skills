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
node andx-init/scripts/scaffold.mjs app /path/to/repo
```

## Install

Requires Node.js 22.18+ (no npm dependencies; `npm test` runs the test suite).

```bash
node install.mjs
node install-companions.mjs   # optional; React/Next companions
```

Symlinks into `~/.cursor/skills/`, `~/.claude/skills/`, and `~/.codex/skills/` (Windows: directory junctions, no admin needed). `node install.mjs --uninstall-hooks` removes only the hooks.

## Edit workflow

1. Edit only this repo (`~/Dev/tools/andx-skills/`).
2. Re-run `node install.mjs` after pull/change.

## Conventions (Cursor-primary)

- Plans: project-local `.cursor/plans/` only.
- Worktrees: `$REPO_ROOT/.worktrees/exec-<slug>-<stamp>` (orch slug naming).
- `move_agent_to_root` only when workspace ≠ target **project** (`/andx-plan`, `/andx-init`). Never for exec worktrees — worker uses `WORKTREE_DIR` as tool cwd in the same workspace.
- Flow: `/andx-plan` → optional `/andx-schedule` (multi-wave) → `/andx-execute` (or execute-and-review / execute-and-deploy / execute-review-and-deploy).
- After `/andx-plan`: Next menu. Recommended: open a fresh chat (Claude Code: `/clear`) and paste its `Fresh chat: /andx-<default> <abs plan path>` line, so execution requests do not carry the grill transcript. Fallback: bare `go` runs the default skill in the same thread, grill context included.
- Companions (`grilling`, `tdd`, `impeccable`, …): `node install-companions.mjs` (Matt Pocock skills pinned clone + react-best-practices).
- Ponytail: resolve via HARNESS (not `skills-cursor/`).

## Recommended harness settings

- Claude Code ≥ 2.1.312: older versions ignore the agents' `autoCompactWindow: 200000` when it is lower than the session window.
- `export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` (shell profile): caps parent context before compaction; without it a 1M-context model grows toward 1M and every request pays for it.
- Frontmatter already sets `effort: medium` on the orchestrator skills and the spec reviewer; the worker, security reviewer, and refuter inherit the session model and effort. `node scripts/check-skills.mjs` rejects frontmatter keys neither Cursor nor Claude Code documents.

## Spend baseline

`node scripts/spend-report.mjs --summary ~/.claude/projects` (2026-10-29, 90 Claude Code runs that invoke an andx skill; input = uncached + cache write + cache read):

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

**Target:** −40% per-skill median input total over the next 10 runs of each skill, judged primarily on the `andx-execute*` skills; compare a skill only with its own baseline row. Caveat: most baseline execution ran in the planning thread (`go`), so it sits in the `andx-plan` row. After a fresh-chat handoff, add each feature's plan-run and execute-run input totals, and compare the median of those sums with the `andx-plan` baseline; a falling `andx-plan` row alone only shows execution moving out. Per-run detail: `node scripts/spend-report.mjs <session.jsonl|dir>`.

## Companion skills

External skills the andx skills route to (see [SKILL-MAP.md](./andx-orchestration/SKILL-MAP.md) for when). **Required** ones are needed for the full plan → execute → review flow; the rest are optional.

| Skill | Source | Used by | |
|-------|--------|---------|--|
| `grilling` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/productivity/grilling) | `andx-plan` grill rounds | Required |
| `tdd` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering/tdd) | worker Red → Green | Required |
| `codebase-design` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering/codebase-design) | `andx-plan` design pass | Required |
| `diagnosing-bugs` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering/diagnosing-bugs) | `andx-debug-and-fix` | Required for debug |
| `wizard`, `pr`, `retro` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering) | deploy secrets, MR body, post-run retro | Optional |
| `grill-me`, `to-spec`, `to-tickets`, `handoff`, `writing-for-agents`, `improve-codebase-architecture` | [mattpocock/skills](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills) | upstream of `andx-plan` (user-invoked) | Optional |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | UI steps in plan, worker, review | Required for UI |
| `review-bugbot`, `review-security`, `autopilot` | [Cursor built-in skills](https://cursor.com/docs/context/skills#built-in-cursor-skills) | Bugbot reviewer, `--deep` security, GitHub babysit | Required (Cursor) |
| `/code-review` | [Claude Code built-in](https://docs.anthropic.com/en/docs/claude-code) | Bugbot reviewer on Claude Code | Required (Claude Code) |
| `ponytail-review`, `ponytail-audit` | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (Claude Code plugin) | Ponytail + Audit reviewers | Required |
| `react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | worker + React reviewer when `stack: react-next` | Optional |
| `accessibility` | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | A11y reviewer, UI plan steps | Optional |
| `agent-browser` | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | UI step verification | Optional |
| `api-design`, `create-mcp-server`, `observability`, `dependency-upgrade`, `test`, `lint`, `github-workflows` | [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2/tree/main/src/resources/skills) | plan design pass, worker, deploy discovery | Optional |

Vendored, not installed separately: Cloudflare attack classes in `andx-security-review/references/cloudflare/` ([cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill), see [ATTRIBUTION.md](./andx-security-review/references/cloudflare/ATTRIBUTION.md)); the spec reviewer adapts Matt Pocock's [`code-review`](https://github.com/mattpocock/skills/tree/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering/code-review) spec axis.

`node install-companions.mjs` installs the Matt Pocock skills (pinned commit) and `react-best-practices`. Install the rest from their repos, e.g.:

```bash
npx skills add https://github.com/pbakaus/impeccable --skill impeccable
npx skills add https://github.com/addyosmani/web-quality-skills --skill accessibility
npx skills add https://github.com/vercel-labs/agent-browser
claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail
```

## Sample workflow

**One-time setup**

```bash
git clone https://github.com/andreyxdd/andx-skills.git ~/Dev/tools/andx-skills
cd ~/Dev/tools/andx-skills
node install.mjs              # links skills into ~/.cursor, ~/.claude, ~/.codex; agents into ~/.claude/agents; hooks
node install-companions.mjs   # Matt Pocock skills + react-best-practices; prints the per-harness catalog budget
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000   # add to your shell profile (Claude Code ≥ 2.1.312)
```

Then install the other required companions above (impeccable for UI work, ponytail).

**Per feature** (in the target repo, not this one)

1. `/andx-init app` — once per repo: scaffold `IDENTITY.md`, `ROUTING.md`, `knowledge/` (optional, recommended).
2. `/andx-plan add buyer refund requests` — answer the grill rounds (`yes` accepts each recommendation), approve the step list; the plan lands in `.cursor/plans/<slug>.plan.md`.
3. Open a **fresh chat** (Claude Code: `/clear`) and paste the plan's `Fresh chat:` line, e.g. `/andx-execute-and-review /abs/repo/.cursor/plans/buyer-refund-request.plan.md`.
4. The run works in `.worktrees/exec-<slug>-<stamp>`: worker implements per step with TDD, blind reviewers gate, then fast-forward merge to your branch and cleanup. It ends with `MERGED PASS | PUSHED … | MR … | DEPLOYED …`.
5. Ship: pick `/andx-execute-review-and-deploy` in step 3, or run `/andx-deploy` after the merge (first time: `/andx-deploy-init`). Draft MR instead of a local merge: `/andx-execute-and-review --mr` (pushes and babysits). Someone else's MR: `/andx-mr-review <url>`, then `/andx-mr-babysit <url>`.
6. Optional: `/retro` after a run that escalated or needed ≥ 2 review rounds; `node ~/Dev/tools/andx-skills/scripts/spend-report.mjs --summary ~/.claude/projects` to track spend.

Bug instead of feature: `/andx-debug-and-fix <symptom>` (read-only analysis → worktree fix → merge).

## Parallel runs

Three plans, three fresh chats, same repo: paste each plan's `Fresh chat:` line into its own chat. The runs execute (and review) in parallel, each in its own worktree. They ship one at a time, in the order they finish: a ready run waits in a background shell for the repo's ship queue, then integrates the latest branch, lands, and (deploy modes) pushes, deploys and checks health before the next run starts. A run that fails before landing releases its turn; one that fails after landing (post-merge checks or final deploy) halts the queue, and the waiting chats stop and ask you. Fix HEAD, then:

```bash
node ~/.cursor/skills/andx-orchestration/scripts/ship-queue.mjs status --repo .   # holder, waiters, halt reason
node ~/.cursor/skills/andx-orchestration/scripts/ship-queue.mjs resume --repo .   # then re-run the stopped chats
```
