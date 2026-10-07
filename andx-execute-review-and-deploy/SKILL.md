---
name: andx-execute-review-and-deploy
description: "/andx-execute-review-and-deploy: andx-execute-and-review, push, then andx-deploy with health checks. Use for \"execute, review, and deploy\" or \"ship it\"."
---
# Andx Execute, Review, and Deploy

```
A.  /andx-execute-and-review → Definition of done (incl. concurrent merge + cleanup)
A′. Auto-push if origin exists
B–D /andx-deploy
```

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When

Plan ready + review gate + ship to production this run. Else: `/andx-execute-and-review`, `/andx-execute-and-deploy`, `/andx-execute`, `/andx-deploy`, or `/andx-debug-and-fix`. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md) (must not auto-deploy).

## Phase A — Execute and review

Follow [/andx-execute-and-review](../andx-execute-and-review/SKILL.md) through **Definition of done** (orchestration Steps 1–4 concurrent-merge, reviewers 1–3, cleanup evidence). Quote handoff + review PASS + post-merge Phase 3 + cleanup (`git worktree list` before/after) before A′.

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
- [ ] Execute+review DoD + cleanup evidence
- [ ] Pushed origin (or skipped)
- [ ] Deploy + health (andx-deploy)
```

Run ledger `mode: review-deploy`, `required_phases: [A, A′, B, C, D]`; `terminal: DONE` only after fresh health output. End with the orch status line.

## Anti-patterns

- Push/deploy before cleanup evidence
- Parent edits source
- Ad-hoc worktree paths outside `.worktrees/`
- `move_agent_to_root` to exec worktrees (parent stays `REPO_ROOT`)
- Skipping the review gate (use `/andx-execute-and-deploy` if review is not wanted)
