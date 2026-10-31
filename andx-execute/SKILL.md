---
name: andx-execute
description: "/andx-execute: run an approved andx plan in a git worktree via a worker subagent, verify, merge to the current branch, clean up. Use for \"execute the plan\" or \"run the plan\"."
effort: medium
---
# Andx Execute

Approved plan → verified code on `TARGET_BRANCH`. Parent orchestrates; worker implements in worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Orch: [/andx-orchestration](../andx-orchestration/SKILL.md) · Harness: [HARNESS.md](../andx-orchestration/HARNESS.md) · Fields: [PARSE.md](../andx-plan/PARSE.md)

Vague acceptance → `/andx-plan` / `/grill-me`. Do not execute unverifiable plans.

Companions (worker): `/tdd`; `/impeccable` for UI; `react-best-practices` when `REACT_STACK`. Full table → SKILL-MAP.

## Execution rules

1. One falsifiable check per step
2. Fresh output only (HARNESS evidence rule)
3. Minimum that passes
4. Simple beats clever
5. Tracer bullets first

---

# § Orchestrator (parent)

Do not edit application source. Follow orchestration.

## Definition of done

All true: handoff **pass**; verification green on `EXEC_BRANCH`; merged to `TARGET_BRANCH`; post-merge Phase 3 green; cleanup evidence logged; ship queue released (deploy composers: andx-deploy releases after health); run ledger `terminal: DONE`; reply ends with the orch status line ([Run ledger](../andx-orchestration/SKILL.md#run-ledger-composers-execute-debug-and-fix-deploy)).

## Preflight (read-only)

1. Orch Step 1 worktree (always).
2. Anchor plan — prefer `<repo>/.cursor/plans/*.plan.md` with `andx_ready: true`. Missing `depends`/`touch`/`verification` → suggest `/andx-plan`.
3. Parse steps per PARSE.md. Set **`DOCS_ONLY`** when `workstream: docs` or every step `kind: docs`.
4. Load `knowledge_refs` / `design_refs` / `pipeline/<stage>/CONTEXT.md` into worker prompt (`design_refs` = immutable contract).
5. Discover toolchain (test/lint/build/e2e/doc verifier).
6. **`REACT_STACK`:** false if `stack: none` or `workstream: docs`; else true if frontmatter stack ∈ {react,react-next,next} OR package.json has react/next OR touch matches `.tsx|.jsx` or `app|pages|components|src/`.
7. Align verification table with plan `verification` / CI.
8. Classify steps; flag impeccable / react-best-practices per SKILL-MAP.

## Spawn + finish

Orch Step 2 with plan, `REACT_STACK`, `DOCS_ONLY`, OKF block (the worker reads [WORKER.md](./WORKER.md) itself). Pass → orch **Step 4** (concurrent-merge, slug worktrees, same workspace). Fail → report; no merge unless user asks.

**EXEC-MATRIX** (from [/andx-schedule](../andx-schedule/SKILL.md)): if `.cursor/plans/<slug>.EXEC-MATRIX.md` exists beside the plan, spawn **per wave** — up to `max_parallel` workers with disjoint `touch`, sequential orch Step 4 merge of wave branches into `TARGET_BRANCH`, orch cleanup each `WORKTREE_DIR`. No matrix → single worker (classic path).

**Post-merge Phase 3:** full regression + lint always (even `DOCS_ONLY`) + doc verifier if docs touched + every verification-table row. Evidence rule before “done.”

---

# § Worker

Worker phases, path rules, and handoff block: [WORKER.md](./WORKER.md) (the worker reads only that file).
