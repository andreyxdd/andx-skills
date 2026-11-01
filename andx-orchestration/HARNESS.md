# Andx harness matrix

Skills name a capability with "(HARNESS)"; this maps it to tools. Never invent tool parameters. Install layout per harness: README. **Other** = Pi, Gemini, OpenCode, Copilot, Droid, Qwen, Amp, Windsurf, Cline, Goose (skills only).

| Capability | Cursor | Claude Code | Codex | Kimi Code | Other |
|---|---|---|---|---|---|
| **Spawn** named agent, blocking | `Task(subagent_type="andx-worker", run_in_background=false)` | `Agent` + agent name | named agent (`~/.codex/agents`) | `Agent` + agent name | `spawn.mjs --agent NAME` |
| Parallel | several Task calls, one message | several Agent calls, one message | several agents, one turn | several Agent calls | one background `spawn.mjs` each, wait for all |
| **Read-only** agent | `readonly: true` | `disallowedTools` | `spawn.mjs --cli codex --readonly` (agents inherit the sandbox) | `disallowedTools` | `spawn.mjs --readonly` |
| **Resume** agent | `resume=<id>` | `SendMessage` | same thread | same agent | new `spawn.mjs`, prior handoff in the prompt |
| **Long wait** (CI, deploy, queue) | Shell `block_until_ms: 0`, then `AwaitShell` | `Monitor` or background Bash | background exec, poll | background task | background shell, poll |
| **Ask user** | `AskQuestion` | `AskUserQuestion` | `request_user_input`, else numbered options | numbered options | its question tool, else numbered options |
| **Switch workspace root** | `move_agent_to_root` | restart in the repo | restart in the repo | restart in the repo | restart in the repo |
| **Bug review** (slot `bugbot`) | `Task(subagent_type="bugbot")` per `~/.cursor/skills-cursor/review-bugbot/SKILL.md` | `/code-review` (GitLab `--comment` ≥ 2.1.257) | `andx-bug-reviewer`, read-only as above | `andx-bug-reviewer` | `spawn.mjs --agent andx-bug-reviewer --readonly` |
| Stop-hook re-prompt | yes (Claude's hook, max 5) | yes | when `transcript_path` is set | unverified | none |

`spawn.mjs --help` (`~/.agents/skills/andx-orchestration/scripts/`): agent body + prompt file to `claude -p`, `codex exec`, `pi -p` or `kimi -p`; CLI from `--cli` or `git config andx.spawnCli`; `--readonly` exits 3 if `git status` changed. Pi read-only has no shell: put the diff in the prompt file. After any read-only agent the parent checks `git -C <cwd> status --porcelain` is unchanged, else discards the result.

**Never on the default path:** Claude `isolation: worktree`, Cursor `best-of-n-runner`, cloud agents, forks (`Task(resume="self")`, Claude `subagent_type: "fork"`): their own branch fights andx landing, resume, cleanup, blind review. One nesting level; the parent spawns every worker, reviewer and refuter (one union, one ledger).

Frontmatter: agent `model: inherit` (install pins spec reviewer: Cursor `claude-sonnet-5-5`, Claude `sonnet`; Kimi ignores `model`). Claude: `"subagentPromptCacheTtl": "1h"` in `settings.json`.

## Reviewers

Fresh read-only agents, no worker context, judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`. Bug review per the table (Claude fallback: `general-purpose` + Bugbot prompt). Security: `andx-security-reviewer`, then one `andx-refuter` per proposed critical/high, all at once; `--deep` adds Cursor `security-review`. Spec: `andx-spec-reviewer` + plan path, diff, verification table. Ponytail: [ponytail resolve](#ponytail-resolve), mid-tier model (Cursor `claude-sonnet-5-5-high`, Claude `sonnet`). Audit / React / A11y: skill path from [SKILL-MAP.md](./SKILL-MAP.md).

## Ponytail resolve

First hit (also `ponytail-audit`): `~/.agents/skills/ponytail-review/SKILL.md`, `~/.cursor/skills/ponytail-review/SKILL.md`, newest `~/.claude/plugins/cache/ponytail/ponytail/*/skills/ponytail-review/SKILL.md`; none → fail "install the ponytail plugin or symlink it into `~/.agents/skills/`". Never `~/.cursor/skills-cursor/ponytail-*`.

## Goals and continuation

- Cursor goal (optional, parent only): `CreateGoal` once with `{"objective": "<mode-scoped Definition of done>"}` (MR mode never requires DEPLOYED); `UpdateGoal` `{"status": "complete"}` only after a requirement-by-requirement audit with fresh output. Claude `/goal` is user-only.
- Stop hook `hooks/andx-continue.mjs`: re-prompts while the ledger written in this conversation is non-terminal, max 5. Never end DONE to silence it.
- `hooks/guard-primary.mjs` (PreToolUse; parses Codex `apply_patch`): during a non-terminal run denies parent edits to the primary checkout outside `.worktrees/`, `.andx/`, plans/reviews dirs (`run.mjs dirs`); fail-open.

## Evidence rule

No completion / "fixed" / "healthy" claim without **fresh command output in the current message** after the last relevant edit or deploy.
