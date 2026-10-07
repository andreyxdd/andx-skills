---
name: andx-debug-and-fix
description: "/andx-debug-and-fix: reproduce a bug, readonly root-cause analysis, then fix in a worktree worker and merge when verified. Use for \"debug and fix\" or a known symptom with unknown cause."
---
# Andx Debug and Fix

Evidence-first diagnose → plan → worktree fix → merge.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), `/diagnosing-bugs` (Matt Pocock, via install-companions.sh), [WORKER.md](../andx-execute/WORKER.md).

## When

Symptom known; root cause/fix unclear. Greenfield → `/andx-execute`. Plan already verified → execute only.

## Workflow

```
A Parent: read-only repro (must fail)
B Analyst: diagnosing-bugs Phases 1–3 → handoff (no worktree)
C Parent: map handoff → steps + verification table; detect REACT_STACK
0 Orch Step 1 worktree
D New execute worker Phases 0–4 → orch Step 4 concurrent-merge + cleanup
```

Do **not** resume analyst as worker. Run ledger `mode: debug` from Phase A ([orch](../andx-orchestration/SKILL.md#run-ledger-composers-execute-debug-and-fix-deploy)); analyst `fail`/`inconclusive` → `terminal: ESCALATED`. End with the orch status line.

## Phase A — Repro

Anchor symptom; falsifiable repro; run read-only on primary checkout → must fail. No parent source edits.

## Phase B — Analyst

Spawn agent `andx-analyst` (HARNESS). Prompt: symptom, repro output, `REPO_ROOT`, read `~/.cursor/skills/diagnosing-bugs/SKILL.md` and run **Phases 1–3 only** (tight red-capable loop, minimise, 3–5 ranked falsifiable hypotheses), redact secrets, scratch scripts under `/tmp` only. Probes that need source instrumentation go into the handoff as experiments for the worker. Return the handoff below. Skip user decision gate — auto-proceed on `pass` (show the ranked hypotheses in chat).

`fail`/`inconclusive` → stop; no worktree. No edits/commits in Phase B.

```markdown
## Debug analyst handoff

- **Status:** pass | fail | inconclusive
- **Feedback loop:** one command + its red output (red-capable, deterministic, fast)
- **Minimised repro:** smallest scenario still red
- **Hypotheses:** 3–5 ranked, each with its prediction and status (confirmed / killed / open)
- **Correct seam:** where the regression test belongs, or `none` (that is a finding)
- **Root cause:** … (with evidence)
- **Recommended fix:** files, lines, minimal change
- **Verification plan:** commands/tests post-fix
- **Risk:** side effects, confidence
- **Blockers:** (if fail/inconclusive) next falsifiable experiment
```

## Phase C — Plan

From handoff: steps + `touch` + verification table. `REACT_STACK` same rules as execute preflight. Show briefly. Then orch Step 1.

**Workspace rules:** per [workspace rules](../andx-orchestration/WORKSPACE-RULES.md) on the fix `touch`; bake them into steps + verification and pass them to the Phase D worker.

## Phase D — Execute

New worker; prompt includes debug handoff + Phase C plan + `REACT_STACK`. Follow [WORKER.md](../andx-execute/WORKER.md) plus diagnosing-bugs **Phases 4–6**: tagged `[DEBUG-xxxx]` probes only for listed experiments, regression test at the handoff's correct seam before the fix (forced red → `diff` proves the mutation landed), fix, re-run the original loop, grep the tag to zero, commit message states the confirmed hypothesis. No correct seam → document it in the handoff instead of a shallow test. Parent: orch Step 4 concurrent-merge on pass.

## Anti-patterns

- Parent edits source
- Fix during Phase B
- Worktree before handoff `pass`
- Resume analyst as worker
- Done on EXEC_BRANCH without merge + cleanup
