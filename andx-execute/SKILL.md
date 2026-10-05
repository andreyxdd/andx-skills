---
name: andx-execute
description: Orchestrates subagent execution of an approved plan in an always-on worktree branch, merges to the checked-out target branch when verified. TDD and Karpathy-style verification loops. Use for /andx-execute, "execute the plan", or "run the plan".
---

# Andx Execute

Approved plan → verified code on `TARGET_BRANCH`. Parent orchestrates; worker implements in worktree.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Orch: [/andx-orchestration](../andx-orchestration/SKILL.md) · Harness: [HARNESS.md](../andx-orchestration/HARNESS.md) · Format: [PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md)

Vague acceptance → `/andx-plan` / `/grill-me`. Do not execute unverifiable plans.

Companions (worker): `/tdd`; `/impeccable` for UI; `react-best-practices` when `REACT_STACK`. Full table → SKILL-MAP.

## Karpathy guidelines

1. One falsifiable check per step
2. Fresh output only (HARNESS evidence rule)
3. Minimum that passes
4. Simple beats clever
5. Tracer bullets first

---

# § Orchestrator (parent)

Do not edit application source. Follow orchestration.

## Definition of done

All true: handoff **pass**; verification green on `EXEC_BRANCH`; merged to `TARGET_BRANCH`; post-merge Phase 3 green; cleanup evidence logged.

## Preflight (read-only)

1. Orch Step 1 worktree (always).
2. Anchor plan — prefer `<repo>/.cursor/plans/*.plan.md` with `andx_ready: true`. Missing `depends`/`touch`/`verification` → suggest `/andx-plan`.
3. Parse steps per PLAN-FORMAT. Set **`DOCS_ONLY`** when `workstream: docs` or every step `kind: docs`.
4. Load `knowledge_refs` / `design_refs` / `pipeline/<stage>/CONTEXT.md` into worker prompt (`design_refs` = immutable contract).
5. Discover toolchain (test/lint/build/e2e/doc verifier).
6. **`REACT_STACK`:** false if `stack: none` or `workstream: docs`; else true if frontmatter stack ∈ {react,react-next,next} OR package.json has react/next OR touch matches `.tsx|.jsx` or `app|pages|components|src/`.
7. Align verification table with plan `verification` / CI.
8. Classify steps; flag impeccable / react-best-practices per SKILL-MAP.

## Spawn + finish

Orch Step 2 with plan, `REACT_STACK`, `DOCS_ONLY`, OKF block, § Worker pointer, handoff schema. Pass → orch **Step 4** (concurrent-merge, slug worktrees, same workspace). Fail → report; no merge unless user asks.

**EXEC-MATRIX** (from [/andx-schedule](../andx-schedule/SKILL.md)): if `.cursor/plans/<slug>.EXEC-MATRIX.md` exists beside the plan, spawn **per wave** — up to `max_parallel` workers with disjoint `touch`, sequential orch Step 4 merge of wave branches into `TARGET_BRANCH`, orch cleanup each `WORKTREE_DIR`. No matrix → single worker (classic path).

**Post-merge Phase 3:** full regression + lint always (even `DOCS_ONLY`) + doc verifier if docs touched + every verification-table row. Evidence rule before “done.”

---

# § Worker (Phases 0–4)

Work only in `WORKTREE_DIR` on `EXEC_BRANCH`. No merge/push/cleanup. Do **not** call `move_agent_to_root` or `move_agent_to_cloned_root`. Every edit/shell: **absolute** `$WORKTREE_DIR/...` or Shell `working_directory=$WORKTREE_DIR`. Relative paths from `REPO_ROOT` forbidden.

## Phase 0 — Verification table

Before code: dependency-ordered steps with kind / success / verification. UI → add UX criterion. `design_refs` → success traces to contract. Debug origin → pre-fill from analyst handoff.

## Phase 1 — Execute

**`kind: docs` / `DOCS_ONLY`:** edit docs per `doc-sync-map` → run verification → done. No TDD.

**Else:** Red → Green → Refactor (`/tdd`). UI/mixed: `/impeccable` before Red when applicable. `REACT_STACK` + React paths: follow `~/.cursor/skills/react-best-practices/SKILL.md`. Quote gate output. Out of plan → ask or `OUT OF SCOPE`.

**Workspace hygiene (any repo):** if parent/workspace `agents/rules/README.md` lists scoped **plan/dev/execute** rules matching `touch` paths, obey them for the whole Phase 1–3 (subtree SoT, fail-closed contracts, version pins, etc.).

## Phase 2 — Fail loop

Diagnose → fix criterion → implement → re-run (max 3 attempts) → stop with blocker.

## Phase 3 — Final on EXEC_BRANCH

Full regression + lint (even docs) + doc verifier if needed + every table row. Fresh evidence.

**Comment hygiene gate (required):** follow [CODE-COMMENTS.md](./CODE-COMMENTS.md). From
`TARGET_BRANCH...HEAD` (or matrix base), fail closed on added harness jargon:

```bash
git diff "$TARGET_BRANCH"...HEAD | rg -n '^\+.*(ponytail:|shrink:|andx:|caveman|/andx-|andx/exec-)' && exit 1 || true
```

Rewrite hits to plain English / public branch pins before Phase 4.

## Phase 4 — Commit

Stage plan scope; conventional commits; clean `git status`. Return orch handoff schema.

## Worker anti-patterns

Table after coding; TDD on docs; stale pass claims; impeccable on backend-only; skip react-best-practices when `REACT_STACK`; merge/remove worktree from worker; `move_agent_to_root` / `move_agent_to_cloned_root`; relative paths from `REPO_ROOT` (hit TARGET checkout — use absolute `$WORKTREE_DIR/...` or Shell `working_directory=$WORKTREE_DIR`).
