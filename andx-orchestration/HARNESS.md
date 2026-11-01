# Andx harness matrix

Spawn details for Cursor (primary) and Claude Code. Never invent tool parameters.

## Agents (`~/.claude/agents/` via `node install.mjs`; Cursor reads it too)

| Agent | Role | Mode |
|-------|------|------|
| `andx-worker` | Implement in `WORKTREE_DIR`, return `## Handoff` | writes |
| `andx-analyst` | Debug Phase B root cause, return `## Debug analyst handoff` | read-only (Cursor `readonly: true`, Claude `disallowedTools`) |

## Spawning

| | Cursor | Claude Code |
|---|--------|-------------|
| Tool | `Task(subagent_type="andx-worker" \| "andx-analyst", run_in_background=false)` | `Agent` with the agent name |
| Fallback (agent not listed) | `generalPurpose` + the agent file body in the prompt | same |
| Parallel | several Task calls in one message | several Agent calls in one message |
| Continue agent | `resume=<id>` | `SendMessage` to the agent |
| Background | always `run_in_background=false` (background ends the parent turn) | Desktop/VS Code background subagents: wait for the handoff first |
| Long wait (CI, deploy, ship queue) | Shell with `block_until_ms: 0`, then `AwaitShell` (queue: `GRANTED\|HALTED`) | `Monitor` or background Bash, then await the notification (same lines) |
| Nesting | allowed (2.5+), one level deep | allowed (nested `Agent` calls) |
| andx choice | parent spawns every worker, reviewer and refuter: blind reviewers, one union, one ledger | same |
| Fork (breaks blind review) | never `Task(resume="self")` | never `subagent_type: "fork"` (on by default) |
| Frontmatter | agent `model: inherit` or `claude-opus-5[effort=high]`, `readonly`, `is_background`; skill `paths:` globs, `disable-model-invocation` | `effort:`; agent `autoCompactWindow:` (≥ 2.1.312); skill `paths:` |
| Discovery | skills: `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`; agents: `~/.cursor/agents`, `~/.claude/agents` | `~/.claude/skills`, `~/.claude/agents` |
| Subagent prompt cache | none documented | `"subagentPromptCacheTtl": "1h"` in `settings.json` (default 5m) |
| Guard | `hooks/guard-primary.mjs` (`preToolUse`): during a non-terminal run, denies parent edits to the primary checkout outside `.worktrees/`, `.cursor/plans/`, `.cursor/reviews/`; fail-open | same hook (`PreToolUse`) |

**Never on the default path:** Claude `isolation: worktree`, Cursor `best-of-n-runner`, cloud agents. Their own branch/worktree fights andx landing, `resume`, cleanup.

## Reviewers (`/andx-execute-and-review`, `/andx-mr-review`)

Fresh agents, no worker context, judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`, never edit app source.

| Role | Cursor | Claude Code |
|------|--------|-------------|
| Bugbot (always) | `Task(subagent_type="bugbot")` per `~/.cursor/skills-cursor/review-bugbot/SKILL.md` | built-in `/code-review` by the orchestrator (GitLab `--comment` needs ≥ 2.1.257); else `general-purpose` with the Bugbot prompt |
| Security (always) | `Task(subagent_type="andx-security-reviewer")`; then parent spawns one `andx-refuter` per proposed critical/high in one message. `--deep` adds Cursor `security-review` | `Agent` with the same agent names |
| Ponytail (always) | `generalPurpose` + [ponytail resolve](#ponytail-resolve) | same |
| Spec (always) | `Task(subagent_type="andx-spec-reviewer")` with plan path + diff + verification table | `Agent` with the same name |
| Model (mid-tier) | Spec: install pins `claude-sonnet-5-5` ([format](https://cursor.com/docs/context/subagents); id unverified (no live model list), Cursor may fall back: check the task card after install); Ponytail: `model="claude-sonnet-5-5-high"` | Spec `sonnet`, Ponytail `model: "sonnet"` |
| Audit / React / A11y (conditional) | `generalPurpose` + skill path from [SKILL-MAP.md](./SKILL-MAP.md) | same |

## Ponytail resolve

First hit wins (same for `ponytail-audit`): `~/.cursor/skills/ponytail-review/SKILL.md`, then the newest `~/.claude/plugins/cache/ponytail/ponytail/*/skills/ponytail-review/SKILL.md`; none → fail with "install the ponytail plugin or symlink it into `~/.cursor/skills/`". Never `~/.cursor/skills-cursor/ponytail-*`.

## Goals and continuation

- Cursor (optional, parent only): call `CreateGoal` exactly once with `{"objective": "<mode-scoped Definition of done>"}` (MR mode never requires DEPLOYED). Call `UpdateGoal` with `{"status": "complete"}` only after a requirement-by-requirement audit with fresh output.
- Stop hook `hooks/andx-continue.mjs` (both harnesses): re-prompts while the ledger written in this conversation is non-terminal, max 5 pushes. Never end DONE to silence it. Claude `/goal` is user-only.

## Evidence rule

No completion / "fixed" / "healthy" claim without **fresh command output in the current message** after the last relevant edit or deploy.
