# Glossary

**Worktree backend:** the tool `worktree.mjs` uses to create and remove run worktrees, set by `git config andx.worktreeBackend`: `native` (plain git, the default), `wt` (worktrunk, required) or `auto` (worktrunk when installed, else native). Either way the worktree gets the same name, lock, seed, setup, ledger entry and output. Landing never depends on it.

**Seeding:** copying git-ignored files listed in the primary checkout's `.worktreeinclude` (dependencies, local env files) into a new worktree before setup, so it does not start cold. A file is copied only if it matches `.worktreeinclude` and is git-ignored; copies are copy-on-write clones, relative symlinks stay relative, and files already in the worktree are kept.

**Liveness lock:** the `git worktree lock` that `worktree.mjs create` puts on every worktree it makes, with reason `andx <slug> <branch>`. While it holds, git, worktrunk, Claude Code and `worktree.mjs sweep` refuse to delete the worktree. `worktree.mjs remove <slug>` lifts only its own slug's locks; `sweep` lifts a lock only when that run's ledger is terminal or untouched for 24 hours (a dead run).
