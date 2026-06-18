---
name: andx-debug-and-fix
description: Debugs a reported issue via subagent in an always-on worktree, then executes a plan through the andx-execute worker. Parent orchestrates; merges to checked-out target branch when verified. Use for /andx-debug-and-fix or "debug and fix".
---

# Andx Debug and Fix

Stabilize the failure first, then execute a written plan. Parent orchestrates; subagent edits source only in the worktree.

## When to use

- User invokes `/andx-debug-and-fix` or reports a bug/failure without a ready execution plan
- Symptom is known (error, regression, broken behavior) but root cause or fix path is unclear
- User wants: debug → fix loop → plan → execute (with commit)

**Not for:** greenfield features with no failure (use `/andx-execute` only).

**If the plan already exists and is verified** — use [/andx-execute](../andx-execute/SKILL.md) Orchestrator only.

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Always-on worktree, spawn, merge-back (parent) |
| [/andx-execute](../andx-execute/SKILL.md) | Worker Phases 0–4 for Phase D (subagent) |
| `fresh verification output in the current message before completion claims` | Fresh output before "fixed" or "done" |
| `/tdd` | Test-first after debug (subagent) |
| `/impeccable` | UI bugs only (subagent) |

Optional: `/grill-me` when expected behavior is ambiguous.

## Karpathy guidelines (debug phase)

Same as andx-execute: one falsifiable check per attempt, fresh output only, minimum change that passes, simple beats clever.

## Workflow overview

```
0. Parent: orchestration Step 1 (always-on worktree)
A. Parent: intake & read-only repro
B. Subagent: debug loop in worktree
C. Parent: execution plan + verification table (no source edits)
D. Subagent: /andx-execute Worker Phases 0–4 (resume or spawn)
   Parent: merge-back + post-merge Phase 3
```

## Phase ownership

| Phase | Parent | Subagent |
|-------|--------|----------|
| 0 Worktree | Always via [/andx-orchestration](../andx-orchestration/SKILL.md) Step 1 | — |
| A Intake & repro | Read-only repro (run existing tests, read logs) | Spawn when first source edit needed (e.g. failing test) |
| B Debug loop | — | All fix attempts in `WORKTREE_DIR` |
| C Execution plan | Plan + verification table in chat | — |
| D Execute | Spawn or `resume` subagent; merge on pass | andx-execute **§ Worker** |

Use **one** `EXEC_BRANCH` / worktree for the whole run when possible. Resume the same subagent from Phase B into Phase D. New spawn only if prior subagent failed hard or worktree was torn down.

**Completion** = bug fixed, plan executed, **merged into `TARGET_BRANCH`**, post-merge verification passes (same as andx-execute Definition of done).

---

## Phase A — Intake and repro (parent)

1. **Anchor the report** — quote symptom, expected vs actual, and source (issue, message, stack trace, screenshot).
2. **Repro success criterion** — one falsifiable sentence + command or steps.
3. Run repro **read-only** on primary checkout → must **fail** before debugging. If it passes, reconcile with the user.

No source edits from parent. If a failing test must be added, create worktree (Step 0) and spawn subagent for that edit before Phase B.

---

## Phase B — Debug loop (subagent worker)

Subagent prompt: debug worker in `WORKTREE_DIR`. Repeat until **bug success criterion** passes:

```
1. Diagnose — one root cause
2. Plan fix — minimal change; state bug success criterion if it changed
3. Implement — smallest diff
4. Validate — run bug success criterion (fresh output)
5. FAIL → back to 1 (max 3 attempts per distinct root-cause hypothesis)
6. PASS → exit Phase B; return handoff with bug criterion evidence
```

Rules:

- **Bug success criterion** is separate from later **plan step** criteria.
- Prefer a **failing test** as the criterion when possible.
- **UI bugs:** `/impeccable` only if the fix touches UI.
- After **3** failed attempts: fail handoff with blocker; parent does not merge.

Do not expand scope during Phase B. Log `OUT OF SCOPE` and ask before unrelated changes.

---

## Phase C — Execution plan (parent)

After Phase B subagent handoff passes:

1. List remaining steps to **ship** the fix safely (regression tests, docs, edge cases).
2. If nothing remains except commit → single step: final regression + commit.
3. Build **verification table** (same columns as andx-execute Phase 0).
4. Show plan and table briefly before Phase D.

No source edits from parent.

---

## Phase D — Execute (subagent + parent merge)

**Subagent:** Follow [/andx-execute](../andx-execute/SKILL.md) **§ Worker** Phases 0–4. Reuse verification table from Phase C. Resume Phase B subagent when possible.

**Parent:** On worker pass → [/andx-orchestration](../andx-orchestration/SKILL.md) Step 4 (merge, post-merge Phase 3, **mandatory worktree cleanup** with evidence).

If Phase C is only "regression + commit", worker still runs Phase 3 on `EXEC_BRANCH` before commit.

---

## Progress tracking

```
Debug (report: …; target: main; exec: andx/exec-…):
- [x] Worktree created
- [x] Repro confirmed — `…`
- [x] Bug criterion met (subagent)
- [x] Merged to target — post-merge Phase 3 passed
- [x] Worktree cleaned — `git worktree list` shows no andx/exec-…
```

Update checkboxes only after gated validation.

## Evidence format

Same as andx-execute: **command**, **outcome**, **snippet** per gate.

## Anti-patterns

- Parent editing source during intake, plan, or merge
- Executing a large plan before the bug criterion passes
- Skipping repro or accepting "can't reproduce" without a written next step
- Finishing on `EXEC_BRANCH` without merge + post-merge verification
- Leaving worktree orphaned after successful debug+execute merge
- Skipping worktree because tree is clean
- Reusing stale subagent output across fix attempts

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Plan missing depends/touch/verification | `/andx-plan` |
| Plan already approved | `/andx-execute` Orchestrator only |
| Expected behavior unclear | `/grill-me` |
| Execution / TDD | `/andx-execute` Worker + `/tdd` |
| UI defect | `/impeccable` |
| Security regression | `/security-review` |
