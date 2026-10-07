# Andx harness matrix

Cursor-primary, Claude Code supported. Same skills and agents in both; spawn details live here, entry skills describe roles + contracts only. Never invent tool parameters.

## Agents (`~/.claude/agents/`, installed by `install.sh`; Cursor reads the same dir)

| Agent | Role | Mode |
|-------|------|------|
| `andx-worker` | Implement in `WORKTREE_DIR`, return `## Handoff` | writes |
| `andx-analyst` | Debug Phase B root cause, return `## Debug analyst handoff` | read-only (Cursor `readonly: true`, Claude `disallowedTools`) |

## Spawning

| | Cursor | Claude Code |
|---|--------|-------------|
| Tool | `Task(subagent_type="andx-worker" \| "andx-analyst", run_in_background=false)` | `Agent` tool with the agent name |
| Fallback (agent not listed in this session) | `generalPurpose` + paste the agent file body into the prompt | same |
| Parallel | several Task calls in one message | several Agent calls in one message |
| Continue same agent | `resume=<id>` | `SendMessage` to the agent |
| Background | always `run_in_background=false` (background ends the parent turn) | Claude may background subagents anyway → parent waits for the handoff before the next phase |
| Nesting | subagents cannot spawn subagents → parent spawns every reviewer and refuter | same rule, for portability |

Worker prompt: absolute `$WORKTREE_DIR/...` paths or Shell `working_directory=$WORKTREE_DIR`; never `move_agent_to_root` to a worktree. Parent stays at `REPO_ROOT`, merges, and cleans up ([SKILL.md](./SKILL.md) Step 4).

**Never on the default path:** Claude `isolation: worktree`, Cursor `best-of-n-runner`, cloud agents. They create their own branch/worktree and fight andx merge, `resume`, and cleanup. Parallel experiments only.

## Reviewers (`/andx-execute-and-review`, `/andx-mr-review`)

Fresh agents, no worker context, judge only `git diff $MERGE_BASE_SHA..$EXEC_HEAD`, never edit app source.

| Role | Cursor | Claude Code |
|------|--------|-------------|
| 1 Bugbot (always) | `Task(subagent_type="bugbot")` per `~/.cursor/skills-cursor/review-bugbot/SKILL.md` | built-in `/code-review` run by the orchestrator (GitLab `--comment` needs ≥ 2.1.257); else `general-purpose` with the Bugbot prompt |
| 2 Security (always) | `Task(subagent_type="andx-security-reviewer")`; then parent spawns one `andx-refuter` per proposed critical/high (all in one message). `--deep` adds Cursor `security-review` | `Agent` with the same agent names |
| 3 Ponytail-review (always) | `generalPurpose` + [ponytail resolve](#ponytail-resolve) | same |
| Ponytail-audit / react / a11y (conditional) | `generalPurpose` + skill path from [SKILL-MAP.md](./SKILL-MAP.md) | same |

Normalize every reviewer's output with `andx-execute-and-review/scripts/parse_review.rb` before union.

## Ponytail resolve

Try in order; stop at first hit:

1. `~/.cursor/skills/ponytail-review/SKILL.md` (and `ponytail-audit`)
2. Newest `~/.claude/plugins/cache/ponytail/ponytail/*/skills/ponytail-review/SKILL.md` (and `ponytail-audit`)
3. Fail with: install ponytail plugin / symlink into `~/.cursor/skills/`

Never use `~/.cursor/skills-cursor/ponytail-*` (not shipped there).

## Goals and continuation

- Cursor: parent may `CreateGoal` per the run ledger ([SKILL.md](./SKILL.md) Run ledger); subagents cannot.
- Claude: `/goal` is user-only; the andx Stop hook (`hooks/andx_continue.rb`) continues a non-terminal ledger instead.

## Evidence rule

No completion / "fixed" / "healthy" claim without **fresh command output in the current message** after the last relevant edit or deploy.
