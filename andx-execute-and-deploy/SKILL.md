---
name: andx-execute-and-deploy
description: "/andx-execute-and-deploy: andx-execute, push, then andx-deploy with health checks (no review gate). Use for \"execute and deploy\"."
disable-model-invocation: true
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

Follow [/andx-execute](../andx-execute/SKILL.md) § Orchestrator through **Definition of done** (orchestration Steps 1–4, including concurrent-merge). Quote handoff + post-merge Phase 3 + cleanup (`git worktree list` before/after) before A′.

## Phase A′ — Auto-push

From `REPO_ROOT` on `TARGET_BRANCH` after cleanup:

```bash
git remote get-url origin && git push -u origin HEAD
```

No origin → skip push, note it. Never force-push `main`/`master` without ask. If push fails and deploy needs remote, fix before deploy.

## Phases B–D — Deploy

Follow [/andx-deploy](../andx-deploy/SKILL.md) Preflight→D. Discover deploy from **this repo’s** docs/Makefile/workflows/`.cursor/rules/*deploy*` every run — never from memory of another project. Source hotfixes → orchestration worktree worker.

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
