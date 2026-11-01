# andx-skills

Canonical **andx** agent skills for any coding-agent harness. Full support (skills, agents, hooks): Cursor, Claude Code, Codex, Kimi Code. Skills only, with workers and reviewers run through `spawn.mjs`: Pi, Gemini CLI, OpenCode, Copilot, Droid, Qwen, Amp, Windsurf, Cline, Goose. Skills name capabilities ("spawn", "long wait", "ask user"); [andx-orchestration/HARNESS.md](./andx-orchestration/HARNESS.md) maps them to each harness's tools.

## Skills

| Skill | Purpose |
|-------|---------|
| `andx-init` | Scaffold OKF + ICM layout (presets: app, data, content) |
| `andx-plan` | Grill + write `$PLANS_DIR/*.plan.md` (see [Project data](#project-data)); Next menu + `go` |
| `andx-schedule` | Build EXEC-MATRIX waves from depends+touch; enable parallel execute |
| `andx-execute` | Worktree execution + TDD + merge; `--deploy` adds push + deploy |
| `andx-execute-and-review` | Execute + adversarial review gate; `--deploy`, `--mr` |
| `andx-execute-and-deploy` | Alias of `/andx-execute --deploy` |
| `andx-execute-review-and-deploy` | Alias of `/andx-execute-and-review --deploy` |
| `andx-debug-and-fix` | Readonly debug analysis → execute worker |
| `andx-deploy` | Deploy + health check (discover from **this** repo) |
| `andx-deploy-init` | First-time CI/CD grill, checklist, review-gated plan |
| `andx-mr-review` | Remote MR review + comment posting |
| `andx-mr-babysit` | Remote MR/PR merge-ready loop (conflicts/comments/CI) |
| `andx-orchestration` | Shared parent/worktree protocol + SKILL-MAP + HARNESS |

## Single sources of truth

| File | Owns |
|------|------|
| `andx-orchestration/SKILL.md` | Worktree, spawn checklist, handoff, landing, cleanup |
| `andx-orchestration/scripts/` | `run.mjs` (run ledger, `dirs`), `worktree.mjs` (create/remove/sweep), `ship-queue.mjs` (queue + landing), `spawn.mjs` (headless agent runs); rules in each `--help` |
| `andx-orchestration/HARNESS.md` | Capability → tool mapping per harness |
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

Presets: `app` | `data` | `content`. Scaffold **additive** (never overwrite); gitignore `pipeline/*/output/` and a hidden plans dir (default `.andx/plans/`).

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

Skills are symlinked (Windows: directory junctions, no admin needed) into `~/.agents/skills/`, the shared folder every harness but Claude Code reads, and `~/.claude/skills/`. Links older installs made in `~/.cursor/skills/` and `~/.codex/skills/` are removed, because Cursor also reads `~/.agents`, `~/.claude` and `~/.codex` and would list each skill more than once; real folders there are left alone.

| | Cursor | Claude Code | Codex | Kimi Code |
|---|---|---|---|---|
| Skills | `~/.agents/skills` | `~/.claude/skills` | `~/.agents/skills` | `~/.agents/skills` |
| Agents | `~/.claude/agents` (spec reviewer: copy in `~/.cursor/agents`) | `~/.claude/agents` | `~/.codex/agents/*.toml`, generated | `~/.kimi-code/agents` |
| Hooks | `~/.cursor/hooks.json`, plus it runs Claude's | `~/.claude/settings.json` | `~/.codex/hooks.json` | marked `[[hooks]]` block in `~/.kimi-code/config.toml` |

Codex and Kimi entries are written only when `~/.codex` / `~/.kimi-code` exists, so re-run `node install.mjs` after installing one. The hooks include `guard-primary.mjs`, which denies the parent's file edits in the primary checkout (outside `.worktrees/`, `.andx/` and the plans/reviews dirs) while a run is active; Codex `apply_patch` edits are checked by the paths in the patch. `node install.mjs --uninstall-hooks` removes only the hooks.

Untested on real Codex / Kimi installs (fake-CLI and temp-home tests only). Unverified: whether Codex and Kimi pass `transcript_path` to the Stop hook (without it the auto-continue hook does nothing), and whether Codex needs a feature flag for `hooks.json`.

**Skills only, any harness:** `npx skills add -g andreyxdd/andx-skills` ([vercel-labs/skills](https://github.com/vercel-labs/skills)) copies the skill folders into each detected harness's global folder. It brings no agents, hooks or `git config`, and `spawn.mjs` needs the repo's `agents/`, so planning and single-agent skills work but execute/review need the clone + `node install.mjs`.

### Harnesses without named read-only agents

`node ~/.agents/skills/andx-orchestration/scripts/spawn.mjs --agent andx-bug-reviewer --cwd "$WORKTREE_DIR" --prompt-file p.md --readonly` runs an agent file through a headless CLI: `claude -p`, `codex exec`, `pi -p` or `kimi -p`. Pick the CLI with `--cli` or once with `git config --global andx.spawnCli pi`. `--readonly` maps to each CLI's read-only switch (Codex `--sandbox read-only`, Claude `--disallowedTools`, Pi `--tools read,grep,find,ls`; Kimi has none and is refused) and exits 3 if the agent changed `git status` anyway. Codex agents inherit the parent's sandbox, so read-only roles on Codex go through `spawn.mjs` too. Where Bugbot (Cursor) and `/code-review` (Claude) are missing, the `andx-bug-reviewer` agent fills the bug-review slot.

### Project data

Plans and review records live in the target repo. `node ~/.agents/skills/andx-orchestration/scripts/run.mjs dirs [--ensure]` prints `PLANS_DIR=` and `REVIEWS_DIR=`: the first existing of `.andx/plans`, `.cursor/plans`, `.claude/plans`, `docs/plans`, `plans` (reviews: `.andx/reviews`, `.cursor/reviews`), else the `.andx` one. A repo that already keeps plans somewhere keeps them there. `--ensure` creates both and adds `.andx/plans/` (`.andx/reviews/`) to `.gitignore` when `.cursor/plans/` (`.cursor/reviews/`) is already ignored. Review records stay committable unless reviews were ignored before.

### Worktree backend

`worktree.mjs` creates and removes run worktrees through one of two backends, picked by `git config andx.worktreeBackend` (repo config overrides global; `node install.mjs --worktree-backend wt` sets the global value). Names, locks, ledger entries and the `EXEC_BRANCH=` / `WORKTREE_DIR=` / `TARGET_BRANCH=` / `PORT=` output are the same in every mode; `node andx-orchestration/scripts/worktree.mjs --help` has the full rules.

| Value | Creates / removes with | When worktrunk is missing |
|-------|------------------------|---------------------------|
| `native` (default) | `git worktree add --lock` / `git worktree remove` | not needed |
| `auto` | `wt` when found, else native | prints `BACKEND=native (wt not found)` |
| `wt` | `wt switch --create` + lock / `wt remove` | exit 3 with an install hint, no fallback |

`wt` never gets `--yes`: project hooks in `.config/wt.toml` that you have not approved stop the run until you run `wt config approvals add`. Landing always goes through `ship-queue.mjs land`, never `wt merge` ([ADR 0001](./docs/adr/0001-landing-stays-on-ship-queue.md)).

**Seeding.** A `.worktreeinclude` in the primary checkout (gitignore syntax, the same file Claude Code and worktrunk read) lists git-ignored files to copy into each new worktree before `.cursor/worktrees.json` setup runs. Only entries that match it **and** are git-ignored are copied, as copy-on-write clones with relative symlinks and timestamps kept; existing files are never overwritten. No file, no copy (worktrunk alone would copy every ignored file).

```gitignore
# .worktreeinclude
.env.local
# node_modules/   # optional: rarely faster than a warm-cache install (below)
```

Seeding is for files an install cannot recreate, not for speed. In one measurement (5 runs, one repo: APFS, a 96 MB / 3681-file `node_modules`, a warm-cache `npm install` setup), the native copy made worktree creation 26% slower and worktrunk's `wt step copy-ignored` made it 11.5% faster.

**worktrunk as a companion** (`brew install worktrunk`, optional): `wt list` shows every run worktree with a marker per run state (🤖 running, 💬 waiting for you, ❌ aborted or escalated; set by `run.mjs`, so it works with the native backend too). `wt list statusline --format=claude-code` feeds the Claude Code statusline (`wt config plugins claude install-statusline`), and `wt config plugins claude install` adds the Claude Code plugin.

## Edit workflow

1. Edit only this repo (`~/Dev/tools/andx-skills/`).
2. Re-run `node install.mjs` after pull/change.

## Conventions

- Plans: project-local `$PLANS_DIR` only ([Project data](#project-data)).
- Worktrees: `$REPO_ROOT/.worktrees/exec-<slug>[-w<N>[-<step>]]-<stamp>`, named and created only by `worktree.mjs create`.
- Switch the workspace root (Cursor `move_agent_to_root`, elsewhere restart in the repo) only when workspace ≠ target **project** (`/andx-plan`, `/andx-init`). Never for exec worktrees — worker uses `WORKTREE_DIR` as tool cwd in the same workspace.
- Shared skill prose names capabilities, never one harness's tools: `node scripts/check-skills.mjs` fails on `Task(`, `AwaitShell`, `AskQuestion`, `move_agent_to_root`, `~/.cursor/skills/` and similar outside `HARNESS.md`.
- Flow: `/andx-plan` → optional `/andx-schedule` (multi-wave) → `/andx-execute` (or execute-and-review / execute-and-deploy / execute-review-and-deploy).
- After `/andx-plan`: Next menu. Recommended: open a fresh chat (Claude Code: `/clear`) and paste its `Fresh chat: /andx-<default> <abs plan path>` line, so execution requests do not carry the grill transcript. Fallback: bare `go` runs the default skill in the same thread, grill context included.
- Companions (`grilling`, `tdd`, `impeccable`, …): `node install-companions.mjs` (Matt Pocock skills pinned clone + react-best-practices).
- Ponytail: resolve via HARNESS (not `skills-cursor/`).

## Recommended harness settings

- Claude Code ≥ 2.1.312: older versions ignore the agents' `autoCompactWindow: 200000` when it is lower than the session window.
- `export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` (shell profile): caps parent context before compaction; without it a 1M-context model grows toward 1M and every request pays for it.
- Frontmatter already sets `effort: medium` on the orchestrator skills and the spec reviewer; the worker, security reviewer, and refuter inherit the session model and effort. `node scripts/check-skills.mjs` rejects frontmatter keys neither Cursor nor Claude Code documents (other harnesses ignore keys they do not know).

## Spend baseline

`node scripts/spend-report.mjs --summary ~/.claude/projects` (2026-11-01, 98 Claude Code runs that invoke an andx skill; input = uncached + cache write + cache read). `cost_units` = uncached×1 + cache write×1.25 + cache read×0.1 + output×5, priced relative to the session model's input price; model mix is ignored (`--help`).

| Median per run (all skills) | Value |
|-----------------------------|-------|
| Cost units | 13,730,274 |
| Input tokens, total | 88,468,343 |
| Input tokens, uncached | 1,070 |
| Input tokens, cache write | 2,100,874 |
| Input tokens, cache read | 85,161,807 |
| Input tokens, parent | 34,601,336 |
| Input tokens, subagents | 13,283,361 |
| Requests, parent | 132 |
| Requests, subagents | 134 |
| Output tokens | 162,948 |
| Peak parent context | 395,665 |
| Image tool results | 0 |

Each median is taken independently per metric, so parent + subagents does not add up to total. Cache read is 96.3% of all input tokens (`cache_read_share 0.963`), so input totals mostly count cheap cached reads; compare runs by `cost_units`.

Per first-invoked skill (a run is grouped by the first andx skill its parent session invokes):

| Skill | Runs | Median cost units | Median input total | Median output |
|-------|------|-------------------|--------------------|---------------|
| `andx-plan` | 60 | 19,931,609 | 150,577,547 | 252,921 |
| `andx-mr-review` | 27 | 2,450,128 | 14,612,676 | 32,919 |
| `andx-init` | 5 | 8,087,223 | 46,668,385 | 179,398 |
| `andx-execute` | 3 | 18,783,564 | 130,779,762 | 207,083 |
| `andx-debug-and-fix` | 1 | 3,608,791 | 25,153,371 | 74,919 |
| `andx-execute-and-deploy` | 1 | 607,967 | 3,972,369 | 19,151 |
| `andx-execute-review-and-deploy` | 1 | 20,585,528 | 112,982,358 | 527,069 |

**Target:** median `cost_units` per `andx-execute-and-review` run drops 25% against this baseline over the next 10 runs, and review rounds per run do not rise. Caveat: the baseline has no `andx-execute-and-review` row yet; the nearest reference is `andx-execute-review-and-deploy` (1 run, review included), and most past execution ran in the planning thread (`go`), so it sits in the `andx-plan` row. Compare a skill only with its own row. Per-run detail: `node scripts/spend-report.mjs <session.jsonl|dir>`.

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
| `review-bugbot`, `review-security`, `autopilot` | [Cursor built-in skills](https://cursor.com/docs/context/skills#built-in-cursor-skills) | bug reviewer, `--deep` security, GitHub babysit | Cursor |
| `/code-review` | [Claude Code built-in](https://docs.anthropic.com/en/docs/claude-code) | bug reviewer on Claude Code | Claude Code |
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
node install.mjs              # skills into ~/.agents + ~/.claude; agents + hooks per installed harness (table above)
node install-companions.mjs   # Matt Pocock skills + react-best-practices into ~/.agents + ~/.claude; prints the per-harness catalog budget
git config --global andx.spawnCli pi   # only on a harness without named agents (Pi, Amp, Windsurf, ...)
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000   # add to your shell profile (Claude Code ≥ 2.1.312)
```

Then install the other required companions above (impeccable for UI work, ponytail).

**Per feature** (in the target repo, not this one)

1. `/andx-init app` — once per repo: scaffold `IDENTITY.md`, `ROUTING.md`, `knowledge/` (optional, recommended).
2. `/andx-plan add buyer refund requests` — answer the grill rounds (`yes` accepts each recommendation), approve the step list; the plan lands in `$PLANS_DIR/<slug>.plan.md` (`.andx/plans/` unless the repo already has a plans dir).
3. Open a **fresh chat** (Claude Code: `/clear`) and paste the plan's `Fresh chat:` line, e.g. `/andx-execute-and-review /abs/repo/.andx/plans/buyer-refund-request.plan.md`.
4. The run works in `.worktrees/exec-<slug>-<stamp>`: worker implements per step with TDD, blind reviewers gate, then `ship-queue.mjs land` fast-forwards your branch (never switching branches in your checkout) and `worktree.mjs remove` cleans up. It ends with the `run.mjs end` line `MERGED PASS | PUSHED … | MR … | DEPLOYED …`.
5. Ship: pick `/andx-execute-review-and-deploy` (same as `/andx-execute-and-review --deploy`) in step 3, or run `/andx-deploy` after the merge (first time: `/andx-deploy-init`). Draft MR instead of a local merge: `/andx-execute-and-review --mr` (pushes and babysits). Someone else's MR: `/andx-mr-review <url>`, then `/andx-mr-babysit <url>`.
6. Optional: `/retro` after a run that escalated or needed ≥ 2 review rounds; `node ~/Dev/tools/andx-skills/scripts/spend-report.mjs --summary ~/.claude/projects` to track spend.

Bug instead of feature: `/andx-debug-and-fix <symptom>` (read-only analysis → worktree fix → merge).

## Parallel runs

Three plans, three fresh chats, same repo: paste each plan's `Fresh chat:` line into its own chat. The runs execute (and review) in parallel, each in its own worktree. They ship one at a time, in the order they finish: a ready run waits in a background shell for the repo's ship queue (git refs under `refs/andx/ship/`), then `land` integrates the latest branch, re-runs the tests if that changed anything, and fast-forwards; deploy modes then push, deploy and check health before the next run starts. A run that fails before landing releases its turn; one that fails after landing (post-merge checks or final deploy) halts the queue, and the waiting chats stop and ask you. Fix HEAD, then:

```bash
Q=~/.agents/skills/andx-orchestration/scripts
node $Q/ship-queue.mjs status --repo .   # holder, waiters, halt reason
node $Q/ship-queue.mjs resume --repo .   # then re-run the stopped chats
node $Q/run.mjs show <slug> --repo .     # a run's ledger: phases, terminal state
node $Q/worktree.mjs sweep .             # leftover worktrees; --apply removes clean, merged ones
```
