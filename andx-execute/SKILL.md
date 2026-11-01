---
name: andx-execute
description: "/andx-execute: run an approved andx plan in a git worktree via a worker subagent, verify, merge to the current branch, clean up. Use for \"execute the plan\" or \"run the plan\"."
effort: medium
---
# Andx Execute

Approved plan → verified code on `TARGET_BRANCH`: parent per [/andx-orchestration](../andx-orchestration/SKILL.md), worker in the worktree. `--deploy` (alias `/andx-execute-and-deploy`) adds push + deploy.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Fields: [PARSE.md](../andx-plan/PARSE.md)

Vague acceptance → `/andx-plan` / `/grill-me`. One falsifiable check per step, fresh output only, minimum that passes, tracer bullets first.

## Definition of done

Handoff **pass**; landed; post-merge Phase 3 green; cleanup quoted; lock released (`--deploy`: by andx-deploy after health); `run.mjs end --terminal DONE`, whose status line ends the reply.

## Preflight (read-only)

1. Anchor plan: `<repo>/.cursor/plans/*.plan.md` with `andx_ready: true`; missing `depends`/`touch`/`verification` → `/andx-plan`.
2. Parse steps per PARSE.md. **`DOCS_ONLY`** when `workstream: docs` or every step `kind: docs`.
3. Load `knowledge_refs` / `design_refs` (immutable contract) / `pipeline/<stage>/CONTEXT.md` into the worker prompt.
4. Toolchain (test/lint/build/e2e/doc verifier) → verification table aligned with plan `verification` / CI.
5. **`REACT_STACK`:** unless `stack: none` or docs workstream, true when stack ∈ {react,react-next,next}, package.json has react/next, or touch matches `.tsx|.jsx|app|pages|components|src/`. Flag impeccable / react-best-practices per SKILL-MAP.
6. Orch Step 1: `node "$S/run.mjs" start --slug "$SLUG" --mode execute` (`--deploy`: `deploy`).

## Phase A — Execute

Orch Step 2 with plan, `REACT_STACK`, `DOCS_ONLY`, OKF block (the worker reads [WORKER.md](./WORKER.md) itself). Pass → ledger phase `A`. Fail → report; no merge unless asked.

**EXEC-MATRIX** ([/andx-schedule](../andx-schedule/SKILL.md)): `.cursor/plans/<slug>.EXEC-MATRIX.md` beside the plan → run its waves per its parent spawn contract (waves merge into `EXEC_BRANCH`; the run lands once). Else one worker.

## Phase F — Land

Orch Step 4 (ship-queue land; post-merge Phase 3 + doc verifier if docs changed), then ledger phase `F`. `--deploy`: keep the lock (skip its release); [/andx-deploy](../andx-deploy/SKILL.md) Preflight → D from `REPO_ROOT` pushes, releases after fresh health, or halts.
