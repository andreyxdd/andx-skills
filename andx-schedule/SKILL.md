---
name: andx-schedule
description: "/andx-schedule: build EXEC-MATRIX parallel waves from plan depends+touch so andx-execute can run workers in parallel. Use after andx-plan when 2+ steps can share a wave."
---
# Andx Schedule

Plan → **EXEC-MATRIX** → parallel `/andx-execute` (or execute-and-review / execute-and-deploy / execute-review-and-deploy).

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Orch: [/andx-orchestration](../andx-orchestration/SKILL.md) · Harness: [HARNESS.md](../andx-orchestration/HARNESS.md) · Format: [PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md)

**Before:** `/andx-plan` (plan has `depends` + `touch`). **After:** `/andx-execute` | `/andx-execute-and-review` | `/andx-execute-and-deploy` | `/andx-execute-review-and-deploy`.

## When to run

Run when plan has **≥2 steps that can share a wave**: same wave, deps satisfied, **disjoint** `touch` sets.

**Skip** (no matrix; execute stays single-worker):

- Only 1 step total
- Every wave has ≤1 runnable step after deps
- Overlapping `touch` within a candidate parallel set
- Any step in scope has `touch: unknown` (force sequential)

## Algorithm

1. Anchor plan — prefer `.cursor/plans/<slug>.plan.md` with `andx_ready: true`.
2. Parse steps per PLAN-FORMAT (`depends`, `touch`).
3. Topological waves:
   - Wave 1: `depends: []` (or missing deps on step-1)
   - Wave N: steps whose deps are all in earlier waves
4. Within each wave, partition into parallel-safe groups: disjoint `touch` path prefixes. Overlap → same serial slot (or sequential whole wave).
5. Write matrix (below). Default **`max_parallel: 2`** unless user/plan overrides.

## Artifact

Write **`.cursor/plans/<slug>.EXEC-MATRIX.md`** next to the plan (same dir as `<slug>.plan.md`).

```markdown
---
plan: .cursor/plans/<slug>.plan.md
max_parallel: 2
---

# EXEC-MATRIX — <slug>

## Wave 1
- steps: [step-1, step-3]
- parallel: true   # disjoint touch; ≤ max_parallel workers
- touch: …
- workers: up to min(len(steps), max_parallel)

## Wave 2
- steps: [step-2]
- parallel: false
…
```

If plan lives outside `.cursor/plans/`, write `EXEC-MATRIX.md` beside that plan file.

## Parent spawn contract (for `/andx-execute`)

When EXEC-MATRIX present:

1. **Per wave:** spawn up to `max_parallel` workers, each with **disjoint** `touch` and a dedicated `WORKTREE_DIR` / `EXEC_BRANCH` (orch Step 1). Parallel workers in a wave MUST use `exec-${SLUG}-w${N}-${step-id}-${STAMP}` (not only `w${N}`). Single-step waves: `exec-${SLUG}-w${N}-${STAMP}`. Same workspace — no `move_agent_to_root` to worktrees.
2. Workers implement only their assigned steps; commit on own `EXEC_BRANCH`; return handoff; **no merge**.
3. **Sequential merge** of wave branches into `TARGET_BRANCH` (orch Step 4 concurrent-merge) after all workers in the wave pass + Phase 3 on each `EXEC_BRANCH`.
4. **Cleanup each** `WORKTREE_DIR` / `EXEC_BRANCH` after that wave’s integration merge + post-merge Phase 3 (orch Step 4 cleanup). Subagents never pre-merge cleanup.
5. Next wave starts only after prior wave merged + verified on `TARGET_BRANCH`.

Single-step waves → one worker (same as classic execute).

## Anti-patterns

- Matrix when `touch: unknown` or overlapping touch claimed parallel
- Spawning more workers than `max_parallel`
- Merging wave branches out of order / before all wave handoffs pass
- Skipping orch cleanup for any `WORKTREE_DIR` in the wave
- Editing source in primary checkout (parent stays orchestrator)

## Referenced by

- [/andx-orchestration](../andx-orchestration/SKILL.md)
- [/andx-execute](../andx-execute/SKILL.md)
- [/andx-plan](../andx-plan/SKILL.md)
- [PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md)
