---
name: andx-schedule
description: "/andx-schedule: build EXEC-MATRIX parallel waves from plan depends+touch so andx-execute can run workers in parallel. Use after andx-plan when 2+ steps can share a wave."
disable-model-invocation: true
---
# Andx Schedule

Plan → **EXEC-MATRIX** → parallel waves in any `/andx-execute*` run.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Orch: [/andx-orchestration](../andx-orchestration/SKILL.md) · Harness: [HARNESS.md](../andx-orchestration/HARNESS.md) · Fields: [PARSE.md](../andx-plan/PARSE.md)

**Before:** `/andx-plan` (plan has `depends` + `touch`). **After:** any `/andx-execute*`.

## When to run

Run when plan has **≥2 steps that can share a wave**: same wave, deps satisfied, **disjoint** `touch` sets.

**Skip** (no matrix; execute stays single-worker):

- Only 1 step total
- Every wave has ≤1 runnable step after deps
- Overlapping `touch` within a candidate parallel set
- Any step in scope has `touch: unknown` (force sequential)

## Algorithm

1. Anchor plan — prefer `$PLANS_DIR/<slug>.plan.md` (`run.mjs dirs`) with `andx_ready: true`.
2. Parse steps per PARSE.md (`depends`, `touch`).
3. Topological waves:
   - Wave 1: `depends: []` (or missing deps on step-1)
   - Wave N: steps whose deps are all in earlier waves
4. Within each wave, partition into parallel-safe groups: disjoint `touch` path prefixes. Overlap → same serial slot (or sequential whole wave).
5. Write matrix (below). Default **`max_parallel: 2`** unless user/plan overrides.

## Artifact

Write **`<slug>.EXEC-MATRIX.md`** beside the plan.

```markdown
---
plan: <PLANS_DIR>/<slug>.plan.md
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

## Parent spawn contract (for `/andx-execute`)

When EXEC-MATRIX present, the run worktree from orch Step 1 (`EXEC_BRANCH`, `WORKTREE_DIR`) collects every wave; `ship-queue.mjs land` accepts only that worktree, so the run lands once.

1. **Per wave:** single-step wave → its worker works in `WORKTREE_DIR`. Parallel wave → one `worktree.mjs create --slug "$SLUG" --wave N --step <step-id> --target "$EXEC_BRANCH"` per worker, run one after another; up to `max_parallel` workers with **disjoint** `touch`. Same workspace — never switch the workspace root (HARNESS) to a worktree.
2. Workers implement only their assigned steps, commit on their own branch, return the handoff; **no merge**.
3. After every worker in the wave passes: `git -C "$WORKTREE_DIR" merge --no-edit <step branch>` one at a time (conflict → abort, worker resolves in `WORKTREE_DIR`), Phase 3 there, then `worktree.mjs remove "$SLUG" --wave N --target "$EXEC_BRANCH"`.
4. Next wave starts only after the prior wave merged and verified on `EXEC_BRANCH`. After the last wave: orch Step 4.

## Anti-patterns

- Matrix when `touch: unknown` or overlapping touch claimed parallel
- Spawning more workers than `max_parallel`
- Merging wave branches before all wave handoffs pass
- Skipping cleanup for any worktree in the wave
- Editing source in primary checkout (parent stays orchestrator)
