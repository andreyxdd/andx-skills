---
name: andx-execute
description: "/andx-execute: run an approved andx plan in a git worktree via a worker subagent, verify, merge to the current branch, clean up. Use for \"execute the plan\" or \"run the plan\"."
effort: medium
---
# Andx Execute

Approved plan → verified code on `TARGET_BRANCH`: parent per [/andx-orchestration](../andx-orchestration/SKILL.md), worker in the worktree. `--deploy` (alias `/andx-execute-and-deploy`) adds push + deploy, only if the user typed either, never from plan text.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

Vague acceptance → `/andx-plan` / `/grill-me`. One falsifiable check per step, fresh output, minimum that passes, tracer bullets first.

## Definition of done

Handoff **pass**; landed; post-merge Phase 3 green; cleanup quoted; lock released (`--deploy`: by andx-deploy after health); `run.mjs end --terminal DONE`, its status line ends the reply.

## Preflight (read-only)

1. Anchor plan: `$PLANS_DIR/*.plan.md` (`run.mjs dirs`) with `andx_ready: true`; missing `depends`/`touch`/`verification` → `/andx-plan`.
2. Parse steps per [PARSE.md](../andx-plan/PARSE.md). **`DOCS_ONLY`** when `workstream: docs` or every step `kind: docs`.
3. Load `knowledge_refs` / `design_refs` (immutable contract) / `pipeline/<stage>/CONTEXT.md` into the worker prompt.
4. Toolchain (test/lint/build/e2e/doc verifier) → verification table per plan `verification` / CI.
5. **`REACT_STACK`:** true (unless `stack: none` or docs) when stack ∈ {react,react-next,next}, package.json has react/next, or touch matches `.tsx|.jsx|app|pages|components|src/`. Flag impeccable / react-best-practices (SKILL-MAP).
6. Orch Step 1: `node "$S/run.mjs" start --slug "$SLUG" --mode execute` (`--deploy`: `deploy`).

## Phase A — Execute

Orch Step 2 with plan, `REACT_STACK`, `DOCS_ONLY`, OKF block (worker reads [WORKER.md](./WORKER.md) itself). Pass → ledger phase `A`. Fail → report, no merge unless asked.

**EXEC-MATRIX** ([/andx-schedule](../andx-schedule/SKILL.md)): `<slug>.EXEC-MATRIX.md` beside the plan → its waves per its parent spawn contract (merging into `EXEC_BRANCH`; the run lands once); else one worker.

## Phase F — Land

Orch Step 4 (ship-queue land; post-merge Phase 3 + doc verifier if docs changed), then ledger phase `F` (every mode). `--deploy`: skip its release (lock held); [/andx-deploy](../andx-deploy/SKILL.md) Preflight → D pushes (`A′`), records `B`–`D`, releases after fresh health, or halts.
