---
name: andx-execute
description: "/andx-execute: run an approved andx plan in a git worktree via a worker subagent, verify, merge to the current branch, clean up. Use for \"execute the plan\" or \"run the plan\"."
effort: medium
---
# Andx Execute

Approved plan → verified code on `TARGET_BRANCH`. Parent orchestrates per [/andx-orchestration](../andx-orchestration/SKILL.md) (`run.mjs start --mode execute`); worker implements in the worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Harness: [HARNESS.md](../andx-orchestration/HARNESS.md) · Fields: [PARSE.md](../andx-plan/PARSE.md)

Vague acceptance → `/andx-plan` / `/grill-me`. Do not execute unverifiable plans. Rules: one falsifiable check per step, fresh output only, minimum that passes, tracer bullets first.

## Definition of done

All true: handoff **pass**; landed on `TARGET_BRANCH`; post-merge Phase 3 green; cleanup quoted; lock released (deploy composers: by andx-deploy after health); `run.mjs end --terminal DONE`, whose status line ends the reply.

## Preflight (read-only)

1. Anchor plan: prefer `<repo>/.cursor/plans/*.plan.md` with `andx_ready: true`. Missing `depends`/`touch`/`verification` → suggest `/andx-plan`.
2. Parse steps per PARSE.md. **`DOCS_ONLY`** when `workstream: docs` or every step `kind: docs`.
3. Load `knowledge_refs` / `design_refs` (immutable contract) / `pipeline/<stage>/CONTEXT.md` into the worker prompt.
4. Discover toolchain (test/lint/build/e2e/doc verifier); align the verification table with plan `verification` / CI.
5. **`REACT_STACK`:** false if `stack: none` or `workstream: docs`; else true if frontmatter stack ∈ {react,react-next,next} OR package.json has react/next OR touch matches `.tsx|.jsx` or `app|pages|components|src/`. Flag impeccable / react-best-practices per SKILL-MAP.
6. Orch Step 1 worktree (always).

## Phase A — Execute

Orch Step 2 with plan, `REACT_STACK`, `DOCS_ONLY`, OKF block (the worker reads [WORKER.md](./WORKER.md) itself). Pass → `run.mjs phase "$SLUG" A`. Fail → report; no merge unless the user asks.

**EXEC-MATRIX** (from [/andx-schedule](../andx-schedule/SKILL.md)): if `.cursor/plans/<slug>.EXEC-MATRIX.md` exists beside the plan, run its waves per that skill's parent spawn contract (wave worktrees merge into `EXEC_BRANCH`; the run lands once). No matrix → single worker.

## Phase F — Land

Orch Step 4 (post-merge Phase 3 adds the doc verifier when docs changed), then `run.mjs phase "$SLUG" F`.
