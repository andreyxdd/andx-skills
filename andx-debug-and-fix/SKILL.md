---
name: andx-debug-and-fix
description: Readonly debug-like-expert analysis on primary checkout, then executes the recommended fix via andx-execute worker in a deferred worktree. Parent merges to checked-out target when verified. Use for /andx-debug-and-fix or "debug and fix".
---

# Andx Debug and Fix

Evidence-first diagnose → plan → worktree fix → merge.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), `/debug-like-expert`, [/andx-execute](../andx-execute/SKILL.md) § Worker.

## When

Symptom known; root cause/fix unclear. Greenfield → `/andx-execute`. Plan already verified → execute only.

## Workflow

```
A Parent: read-only repro (must fail)
B Analyst: debug-like-expert → handoff (no worktree)
C Parent: map handoff → steps + verification table; detect REACT_STACK
0 Orch Step 1 worktree
D New execute worker Phases 0–4 → orch Step 4 concurrent-merge + cleanup
```

Do **not** resume analyst as worker.

## Phase A — Repro

Anchor symptom; falsifiable repro; run read-only on primary checkout → must fail. No parent source edits.

## Phase B — Analyst

Spawn per HARNESS **Debug analyst**. Prompt: symptom, repro output, `REPO_ROOT`, follow `/debug-like-expert`, return orch debug handoff schema. Skip user decision gate — auto-proceed on `pass`.

`fail`/`inconclusive` → stop; no worktree. No edits/commits in Phase B.

## Phase C — Plan

From handoff: steps + `touch` + verification table. `REACT_STACK` same rules as execute preflight. Show briefly. Then orch Step 1.

## Phase D — Execute

New worker; prompt includes debug handoff + Phase C plan + `REACT_STACK`. Follow execute § Worker (same workspace; `WORKTREE_DIR` as tool cwd). Parent: orch Step 4 concurrent-merge on pass.

## Anti-patterns

- Parent edits source
- Fix during Phase B
- Worktree before handoff `pass`
- Resume analyst as worker
- Done on EXEC_BRANCH without merge + cleanup
