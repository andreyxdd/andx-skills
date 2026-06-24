---
name: andx-execute
description: Orchestrates subagent execution of an approved plan in an always-on worktree branch, merges to the checked-out target branch when verified. TDD and Karpathy-style verification loops. Use for /andx-execute, "execute the plan", or "run the plan".
---

# Andx Execute

Turn an approved plan into shipped, verified code on `TARGET_BRANCH`. Parent orchestrates; subagent implements in a worktree.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When to use

- User invokes `/andx-execute` or asks to execute/run a plan with verification and commit
- A plan exists: markdown doc, issue/PRD section, ticket, or numbered checklist in the thread
- User wants execution—not more planning

If acceptance criteria are vague, ask clarifying questions, run **`/andx-plan`**, or optionally run `/grill-me`. Do not execute a plan you cannot verify.

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Always-on worktree, subagent spawn, merge-back (parent) |
| `/tdd` | Red → green → refactor (subagent) |
| `fresh verification output in the current message before completion claims` | Evidence before claims (both) |
| `/impeccable` | UI/UX steps only (subagent) |
| `~/.cursor/skills/react-best-practices/SKILL.md` | React/Next steps when `REACT_STACK` (subagent) |

Apply `/impeccable` **only** for steps that change user-visible UI. Skip for backend, CLI, migrations, and config-only work.

Apply `/react-best-practices` when **`REACT_STACK`** and the step touches React/Next paths (`.tsx`, `.jsx`, `app/`, `pages/`, `components/`) or `kind` is `ui`/`mixed`. Skip when `stack: none` in plan frontmatter.

## Karpathy guidelines

1. **One falsifiable check per step** — each step has exactly one success criterion you can fail with a command or test.
2. **Fresh output only** — no step marked done without command output from *after* the last edit.
3. **Minimum that passes** — smallest code change that satisfies the current test.
4. **Simple beats clever** — direct implementations over harnesses and indirection.
5. **Tracer bullets** — prove the end-to-end path first, then add cases.

---

# § Orchestrator (parent — `/andx-execute` entry)

**You are the parent.** Do not edit application source. Follow [/andx-orchestration](../andx-orchestration/SKILL.md).

## Definition of done

Complete only when **all** are true:

- Subagent handoff status is **pass**
- Every verification-table row passed on `EXEC_BRANCH` (from handoff)
- `EXEC_BRANCH` is **merged into** `TARGET_BRANCH`, conflicts resolved
- Phase 3 gates pass again **on `TARGET_BRANCH` after merge**
- Worktree removed and `EXEC_BRANCH` deleted with logged evidence (or documented skip reason for same-checkout fallback)

"Done" on the exec worktree/branch alone is **not** completion.

## Preflight (read-only on primary checkout)

Run once; do not skip:

1. **Worktree** — run orchestration Step 1 (always; never skip for clean tree).
2. **Anchor the plan** — source (file path, issue URL, or message) and step IDs/titles. Prefer **project-local** `.cursor/plans/*.plan.md` with `andx_ready: true` (workspace root = target repo; never `~/.cursor/plans`). If the plan omits steps or lacks `depends`/`touch`/`verification`, suggest **`/andx-plan`** once; do not invent scope.
3. **Parse andx plan steps** — when the plan has `### step-N` blocks, extract `kind`, `depends`, `touch`, `success`, `verification` per [/andx-plan/PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md). Missing `depends` on step-N (N>1) → sequential chain. Topological sort → log computed waves in progress (single worker today).
4. **Load OKF context** — when plan frontmatter includes `pipeline_stage`, `knowledge_refs`, and/or `design_refs`:
   - Read each path in `knowledge_refs` (relative to project root)
   - When `design_refs` present, read those paths and include as **immutable design contract** in worker prompt (endpoints, module interface — drift during execute = out of scope unless user amends plan)
   - Read `pipeline/<pipeline_stage>/CONTEXT.md` when `pipeline_stage` is set
   - Include loaded content in the worker spawn prompt (cited concepts + active stage Inputs/Process/Outputs)
5. **Discover toolchain** — from `package.json`, `pyproject.toml`, `Makefile`, `.github/workflows`, or repo docs: test runner, lint, build, e2e.
6. **Detect React stack** — set **`REACT_STACK`** for worker spawn and progress log:

   ```text
   REACT_STACK = false when plan frontmatter stack: none
   REACT_STACK = true when ANY (otherwise):
     1. plan frontmatter stack ∈ {react, react-next, next}
     2. package.json (root or workspace package matching step touch) lists react or next
     3. ≥1 plan step touch prefix matches .tsx|.jsx or ^(app|pages|components|src)/
   ```

   Log `REACT_STACK: true|false` in orchestrator progress.

7. **Reuse existing gates** — align verification table with plan step `verification` fields, `VERIFICATION.md`, plan appendix, or CI.
8. **Classify steps** — use plan `kind` when present; else each `backend` | `ui` | `mixed`. `ui` and `mixed` trigger `/impeccable` in the worker prompt. When `REACT_STACK`, flag steps whose `touch` includes `.tsx`/`.jsx` or Next app dirs for `/react-best-practices`.

## Spawn worker

After preflight, spawn subagent per orchestration Step 2. Prompt must include:

- Full anchored plan and step classification
- **`REACT_STACK`** boolean and react-best-practices skill path when true
- OKF context block (when plan has `knowledge_refs` / `design_refs` / `pipeline_stage`): cited concept files + design contract + active `pipeline/<stage>/CONTEXT.md`
- Draft verification table (or instruct worker to build in Phase 0)
- Pointer: **§ Worker** section below
- Handoff schema from orchestration

Wait for handoff. On **pass** → orchestration Steps 4 (merge, post-merge Phase 3, cleanup). On **fail** → report blockers; do not merge unless user asks.

## Parent Phase 3 (post-merge)

After merge to `TARGET_BRANCH`:

1. Full regression gate (CI-equivalent: test, lint, build, e2e if applicable).
2. Re-run every verification-table row.
3. Apply `fresh verification output in the current message before completion claims` before completion language.

Use commands discovered in preflight; run from `REPO_ROOT` on `TARGET_BRANCH`.

## Progress tracking

```
Execution (plan: docs/feature-x.md; target: main; exec: andx/exec-…):
- [x] Worktree created
- [x] Subagent handoff — pass
- [x] Merged to main — post-merge Phase 3 passed
- [x] Worktree cleaned — `git worktree list` shows no andx/exec-…
```

## Orchestrator anti-patterns

- Editing source from parent (`StrReplace`/`Write` on app code)
- Skipping worktree when tree is clean
- Deploying or claiming done before merge + post-merge Phase 3
- Trusting subagent output without fresh post-merge gates
- Claiming done without worktree cleanup evidence

---

# § Worker (subagent — Phases 0–4)

**You are the subagent.** All work in `WORKTREE_DIR` on `EXEC_BRANCH`. Do not merge or push unless prompt explicitly allows push.

## Phase 0 — Plan → verification table (mandatory)

Before any production code:

When the plan originates from [/andx-debug-and-fix](../andx-debug-and-fix/SKILL.md), pre-fill the table from the debug analyst handoff **Verification Plan** and **Recommended Fix** steps; validate rows before coding.

1. List steps in **dependency order** (from anchored plan).
2. For **each step**, fill:

| Step | Kind | Success criterion | Verification |
|------|------|-------------------|--------------|
| 1 | backend | One falsifiable sentence | Exact command or test name |

3. **UI steps** — add **UX criterion** (keyboard path, responsive breakpoint, a11y rule, or browser check).
4. When plan has `design_refs`, each backend step's success criterion must trace to an operation in the design contract.
5. Show the table briefly, then start Phase 1. Do not code before the table exists.

## Phase 1 — Execute with TDD

For each step, in order:

**All steps**

1. **Red** — one failing test for observable behavior. Run verification → must fail for the right reason.
2. **Green** — minimal implementation. Run verification → must pass.
3. **Refactor** — only while green; re-run verification after each cleanup.
4. **Gate** — run the step's success criterion. Quote 1–3 relevant lines of output.
5. Mark step done only after the gate passes.

**UI / mixed steps (before Red)**

1. Run `/impeccable` setup (`load-context.mjs`, register from PRODUCT.md).
2. Net-new UI: `/impeccable shape` or `craft` per user intent before tests.
3. Implement with `/tdd` using the project's existing test levels.
4. After GREEN: `/impeccable` polish or `audit` if the plan requires visual/a11y quality.

**React/Next steps** (when `REACT_STACK` and step touches React paths or kind is `ui`/`mixed`):

1. Read `~/.cursor/skills/react-best-practices/SKILL.md`; for touched patterns pull matching `rules/` files (priority: `async-`, `bundle-`, `server-`).
2. Before refactor-at-green: check CRITICAL/HIGH rules apply to the change.
3. After GREEN: scan `rerender-`/`rendering-` rules if state or components changed.
4. Handoff evidence: cite rule id when applying a non-obvious fix (e.g. `bundle-barrel-imports`).

Do not skip steps with open dependencies. Do not batch "all tests then all code."

**Scope guard:** Work not in the plan → ask, or log `OUT OF SCOPE: …` and continue only after user confirms.

## Phase 2 — Validation failure loop

When any verification fails:

```
FAIL → diagnose (one root cause)
     → plan fix + bug success criterion (falsifiable)
     → implement → run bug criterion
     → still FAIL? new fix plan (max 3 attempts per issue)
     → PASS → re-run step gate → next step
```

- Separate **bug** vs **step** success criteria when they differ.
- No "fixed" without fresh passing output.
- After **3** failed attempts: stop with symptom, attempts, blocker, one falsifiable next experiment.

## Phase 3 — Final verification (on EXEC_BRANCH)

1. Full regression gate (CI-equivalent: test, lint, build, e2e if applicable).
2. Re-run every row in the verification table.
3. Apply `fresh verification output in the current message before completion claims` before handoff.

Use focused tests per step in Phase 1; full suite here.

## Phase 4 — Commit (on EXEC_BRANCH)

Only after Phase 3 passes on `EXEC_BRANCH`:

1. `git status` and `git diff` — plan scope only; no secrets or unrelated files.
2. Stage touched paths only.
3. **Commits:** multiple logical chunks → one commit per chunk; otherwise one commit for the run.
4. Conventional Commits: `type(scope): imperative summary`; body = why when not obvious.
5. `git log -1 --stat` and `git status` to confirm.

Before handoff:

- Confirm `git status` is **clean** on `EXEC_BRANCH`
- Do not merge, push, or remove worktree (`git worktree remove` / `git branch -d` are parent-only after merge)

Commit when the user invoked `/andx-execute` or asked to commit. Do not push unless asked.

Return **handoff schema** from [/andx-orchestration](../andx-orchestration/SKILL.md). Do not merge.

## Worker evidence format

Per passed gate: **command**, **outcome** (exit code / pass count), **snippet** (one proof line).

## Worker anti-patterns

- Verification table after coding
- Stale "tests passed" claims
- Refactoring while red
- `/impeccable` on backend-only steps
- Skipping react-best-practices on `.tsx`/React-path steps when `REACT_STACK`
- Merging to `TARGET_BRANCH` from worker
- Removing worktree before parent merge
- One commit mixing unrelated plan chunks

---

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Plan missing depends/touch/verification | `/andx-plan` |
| Bug unknown, need debug then plan | `/andx-debug-and-fix` |
| Execute + production deploy | `/andx-execute-and-deploy` |
| Execute + review gate before merge | `/andx-execute-and-review` |
| Deploy only (code ready) | `/andx-deploy` |
| Plan unclear | `/grill-me` |
| Test discipline | `/tdd` |
| UI/UX step | `/impeccable` |
| React/Next step | `/react-best-practices` |
| New service/job observability | `/observability` |
| UI browser verification | `/agent-browser` |
| Dependency upgrade plan | `/dependency-upgrade` |
| Completion claims | `fresh verification output in the current message before completion claims` |
| Commit wording | `/caveman-commit` |
| Security-sensitive change | `/security-review` |
