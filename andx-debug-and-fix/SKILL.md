---
name: andx-debug-and-fix
description: Readonly debug-like-expert analysis on primary checkout, then executes the recommended fix via andx-execute worker in a deferred worktree. Parent orchestrates; merges to checked-out target branch when verified. Use for /andx-debug-and-fix or "debug and fix".
---

# Andx Debug and Fix

Diagnose with evidence first, then execute a written plan. Parent orchestrates; subagents analyze (readonly) or implement (worktree only).

## When to use

- User invokes `/andx-debug-and-fix` or reports a bug/failure without a ready execution plan
- Symptom is known (error, regression, broken behavior) but root cause or fix path is unclear
- User wants: debug analysis → execution plan → fix (with commit)

**Not for:** greenfield features with no failure (use `/andx-execute` only).

**If the plan already exists and is verified** — use [/andx-execute](../andx-execute/SKILL.md) Orchestrator only.

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Worktree (deferred), spawn, merge-back (parent) |
| `/debug-like-expert` | Phase B readonly analysis (subagent) |
| [/andx-execute](../andx-execute/SKILL.md) | Worker Phases 0–4 for Phase D (subagent) |
| `fresh verification output in the current message before completion claims` | Fresh output before "fixed" or "done" |
| `/tdd` | Test-first in Phase D (subagent) |
| `/impeccable` | UI bugs only (subagent) |

Optional: `/grill-me` when expected behavior is ambiguous.

## Workflow overview

```
A. Parent: intake & read-only repro (primary checkout)
B. Readonly subagent: /debug-like-expert → debug analyst handoff
C. Parent: execution plan + verification table from handoff
0. Parent: orchestration Step 1 (worktree) — BEFORE Phase D only
D. Subagent: /andx-execute Worker Phases 0–4 (new spawn)
   Parent: merge-back + post-merge Phase 3
```

## Phase ownership

| Phase | Parent | Subagent |
|-------|--------|----------|
| A Intake & repro | Read-only repro on `REPO_ROOT` | — |
| B Debug analysis | Spawn readonly analyst; validate handoff | `/debug-like-expert` (no edits) |
| C Execution plan | Map handoff → plan + verification table | — |
| 0 Worktree | Step 1 immediately before Phase D spawn | — |
| D Execute | Spawn execute worker; merge on pass | andx-execute **§ Worker** |

**Do not resume** the Phase B debug analyst into Phase D — different roles (analyst vs implementer). Spawn a **new** execute worker after worktree creation.

**Completion** = bug fixed, plan executed, **merged into `TARGET_BRANCH`**, post-merge verification passes (same as andx-execute Definition of done).

---

## Phase A — Intake and repro (parent)

1. **Anchor the report** — quote symptom, expected vs actual, and source (issue, message, stack trace, screenshot).
2. **Repro success criterion** — one falsifiable sentence + command or steps.
3. Run repro **read-only** on primary checkout → must **fail** before debugging. If it passes, reconcile with the user.

No source edits from parent. Repro uses **existing** tests/commands only. If no automated repro exists, Phase B may recommend adding a failing test; that becomes execute Step 1 (TDD red) in Phase D.

---

## Phase B — Debug analysis (readonly subagent)

Spawn readonly analyst **before** worktree creation:

```text
Task(
  subagent_type="generalPurpose",
  readonly=true,
  description="debug analyst (readonly)",
  prompt="..."
)
```

Prompt must include:

- Symptom anchor, expected vs actual
- Repro criterion + fresh failing command output
- `REPO_ROOT` (primary checkout — no `WORKTREE_DIR` yet)
- Follow `/debug-like-expert` fully
- Return **debug analyst handoff** from [/andx-orchestration](../andx-orchestration/SKILL.md) § Debug analyst handoff
- **Orchestrated override:** skip debug-like-expert decision gate; do not wait for user — parent auto-proceeds to execute when status is `pass`

### Pass gate

Status **`pass`** requires all debug-like-expert success criteria:

- Root cause identified with evidence
- Recommended fix is specific and actionable (files, lines, minimal change)
- Verification plan lists post-fix commands/tests

### Fail gate

Status **`fail`** or **`inconclusive`** → parent stops. No worktree. No Phase D. Report blockers + one falsifiable next experiment.

### Forbidden in Phase B

- Any `StrReplace` / `Write` on source
- Worktree creation or commits
- Implementing the recommended fix

---

## Phase C — Execution plan (parent)

After debug analyst handoff status is **`pass`**:

1. Parse **Recommended Fix** → numbered steps with `touch` paths
2. Parse **Verification Plan** → verification table rows (andx-execute Phase 0 columns)
3. Typical steps when handoff is minimal:
   - Step 1: Add/adjust failing test (if debug recommended)
   - Step 2: Implement recommended fix (cite files/lines from handoff)
   - Step 3: Full regression + commit
4. Build **verification table** (same columns as andx-execute Phase 0)
5. Show plan and table briefly before Phase D

No source edits from parent.

Then run [/andx-orchestration](../andx-orchestration/SKILL.md) **Step 1** (worktree) immediately before Phase D spawn.

---

## Phase D — Execute (subagent + parent merge)

**Subagent:** Spawn **new** worker (not resume Phase B analyst). Follow [/andx-execute](../andx-execute/SKILL.md) **§ Worker** Phases 0–4. Prompt must include:

```text
DEBUG HANDOFF (anchored plan source):
- Root cause: …
- Recommended fix: [file:line] …
- Verification plan: …
- Risk: …

EXECUTION PLAN (from Phase C):
[numbered steps + verification table]

Follow /andx-execute § Worker in WORKTREE_DIR.
Implement Recommended Fix minimally; do not re-investigate unless verification fails (Phase 2 loop).
```

Karpathy guidelines and `/tdd` apply in Phase D only.

**Parent:** On worker pass → [/andx-orchestration](../andx-orchestration/SKILL.md) Step 4 (merge, post-merge Phase 3, **mandatory worktree cleanup** with evidence).

---

## Progress tracking

```
Debug (report: …; target: main; exec: andx/exec-…):
- [x] Repro confirmed — `…`
- [x] Debug analysis complete (readonly subagent)
- [x] Execution plan from debug handoff
- [x] Worktree created
- [x] Execute handoff — pass
- [x] Merged to target — post-merge Phase 3 passed
- [x] Worktree cleaned — `git worktree list` shows no andx/exec-…
```

Update checkboxes only after gated validation.

## Evidence format

Same as andx-execute: **command**, **outcome**, **snippet** per gate.

## Anti-patterns

- Parent editing source during intake, plan, or merge
- Implementing fixes during Phase B (pollutes debug-like-expert evidence)
- Creating worktree before debug handoff completes
- Executing without structured debug handoff (vague root cause)
- Resuming debug analyst as execute worker
- Auto-proceeding when handoff status is `inconclusive`
- Skipping repro or accepting "can't reproduce" without a written next step
- Finishing on `EXEC_BRANCH` without merge + post-merge verification
- Leaving worktree orphaned after successful debug+execute merge
- Reusing stale subagent output across phases

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Plan missing depends/touch/verification | `/andx-plan` |
| Plan already approved | `/andx-execute` Orchestrator only |
| Expected behavior unclear | `/grill-me` |
| Execution / TDD | `/andx-execute` Worker + `/tdd` |
| UI defect | `/impeccable` |
| Security regression | `/security-review` |
