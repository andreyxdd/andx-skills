---
name: andx-execute-and-deploy
description: "/andx-execute-and-deploy: andx-execute, push, then andx-deploy with health checks (no review gate). Use for \"execute and deploy\"."
disable-model-invocation: true
effort: medium
---
# Andx Execute and Deploy

```
A.  /andx-execute → Definition of done (incl. cleanup evidence)
A′. Auto-push if origin exists
B–D /andx-deploy
```

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When

Plan ready + ship **without** a review gate. Review + ship → `/andx-execute-review-and-deploy`. Else: `/andx-execute`, `/andx-deploy`, or `/andx-debug-and-fix`.

## Phase A — Execute

Follow [/andx-execute](../andx-execute/SKILL.md) § Orchestrator through **Definition of done** (orchestration Steps 1–4, including concurrent-merge). Quote handoff + post-merge Phase 3 + cleanup (`git worktree list` before/after) before A′. Keep the `ship-queue` lock under `$SHIP_ID` (skip the execute release): [/andx-deploy](../andx-deploy/SKILL.md) releases it after fresh health, or halts the queue on final failure.

## Phases A′–D — Push and deploy

Follow [/andx-deploy](../andx-deploy/SKILL.md) Preflight → D (its composer entry covers the push). Source hotfixes → orchestration worktree worker.

## Progress

```
- [ ] Execute DoD + cleanup evidence
- [ ] Pushed origin (or skipped)
- [ ] Deploy + health (andx-deploy)
```

Run ledger `mode: deploy`, `required_phases: [A, A′, B, C, D]`; `terminal: DONE` only after fresh health output. End with the orch status line.

## Anti-patterns

- Push/deploy before cleanup evidence
- Parent edits source
- Ad-hoc worktree paths outside `.worktrees/`
- `move_agent_to_root` to exec worktrees (parent stays `REPO_ROOT`; orch Step 2)
