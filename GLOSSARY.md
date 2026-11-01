# Glossary

**Worktree backend:** the tool `worktree.mjs` uses to create and remove run worktrees, set by `git config andx.worktreeBackend`: `native` (plain git, the default), `wt` (worktrunk, required) or `auto` (worktrunk when installed, else native). Either way the worktree gets the same name, lock, seed, setup, ledger entry and output. Landing never depends on it.

**Seeding:** copying git-ignored files listed in the primary checkout's `.worktreeinclude` into a new worktree before setup, mainly the ones a package install cannot recreate, such as local env files. A file is copied only if it matches `.worktreeinclude` and is git-ignored (for an existing branch, by that branch's rules too); copies are copy-on-write clones, relative symlinks stay relative, files already in the worktree are kept, and nothing is written through a link that leads outside it.

**Harness tier:** how much of andx a coding-agent harness gets. Full (Cursor, Claude Code, Codex, Kimi Code): skills, agents and hooks from `node install.mjs`. Skills only (Pi, Gemini CLI, OpenCode, Copilot, Droid, Qwen, Amp, Windsurf, Cline, Goose): skills from `~/.agents/skills`, with workers and reviewers run through the spawn fallback. Skill prose names a capability and `HARNESS.md` maps it per tier.

**Spawn fallback:** `spawn.mjs`, which runs one andx agent file through a harness's own headless CLI (`claude -p`, `codex exec`, `pi -p`, `kimi -p`, picked by `--cli` or `git config andx.spawnCli`) for harnesses whose agents cannot be named or made read-only. A read-only run that changes `git status` exits 3 and its result is discarded.

**Data dir:** where a project keeps andx plans and review records, printed by `run.mjs dirs` as `PLANS_DIR` and `REVIEWS_DIR`: the first that exists of `.andx/plans`, `.cursor/plans`, `.claude/plans`, `docs/plans`, `plans` (reviews: `.andx/reviews`, `.cursor/reviews`), else the `.andx` one. Resolved per checkout, so a run worktree writes its review record into its own tree.

**Liveness lock:** the `git worktree lock` that `worktree.mjs create` puts on every worktree it makes, with reason `andx <slug> <branch>`. While it holds, git, worktrunk, Claude Code and `worktree.mjs sweep` refuse to delete the worktree. `worktree.mjs remove <slug>` lifts only its own slug's locks; `sweep` lifts a lock only when that run's ledger is terminal or untouched for 24 hours (a dead run).
