# Andx Plan Format

Execution-ready plans for `/andx-execute`. Written only to **`<project-root>/.cursor/plans/<slug>.plan.md`** — workspace root must be the target repo. Never `~/.cursor/plans`.

## Full template (code feature)

```markdown
---
name: Human-readable title
overview: One sentence describing outcome
andx_ready: true
domain_grilled: true
design_pass: true
workstream: code
pipeline_stage: 03-build
knowledge_refs: [knowledge/domain/glossary.md, knowledge/apis/refund-request.md]
design_refs: [knowledge/apis/refund-request.md]
companion_skills: [api-design]
stack: react-next
source: thread
todos: []
isProject: false
---

# Plan title

Brief scope paragraph (optional).

## Execution steps

### step-1 — Short title
kind: backend
depends: []
touch: [internal/foo/, api/handlers/foo.go]
success: One falsifiable sentence — observable behavior when done
verification: go test ./internal/foo/... -run TestBar -v

### step-2 — Next title
kind: ui
depends: [step-1]
touch: [web/src/pages/foo/, web/src/components/foo/]
success: Page renders empty state when list is empty
verification: pnpm --filter web test src/pages/foo.test.tsx

## Design contract

- API: knowledge/apis/refund-request.md
- Chosen shape: one paragraph + link; no duplicate of knowledge files

## Next

    Plan: <project>/.cursor/plans/<slug>.plan.md
    Next:
    - (default) /andx-execute
    - /andx-execute-and-review
    - /andx-execute-and-deploy
    - /andx-execute-review-and-deploy
    Reply go → run default on this plan.
```

Outside the plan file: mark exactly one `(default)` per andx-plan session-end rules; chat reply must end with the same Next block.

## Docs workstream template

```markdown
---
name: Document recovery flows like login
overview: Add account/share/disaster recovery diagrams and OKF cross-links
andx_ready: true
domain_grilled: skipped
design_pass: skipped
workstream: docs
pipeline_stage: 03-build
knowledge_refs: [knowledge/doc-sync-map.md, knowledge/domain/glossary.md]
companion_skills: []
stack: none
source: thread
todos: []
isProject: false
---

## Execution steps

### step-1 — Mirror login diagram for account recovery
kind: docs
depends: []
touch: [docs/diagrams/account-recovery-layer-data-flow.md, src/pages/RecoveryFlow/]
success: New diagram matches login doc phases and error-routing sections
verification: pnpm verify:docs

### step-2 — Update doc-sync-map and knowledge/log
kind: docs
depends: [step-1]
touch: [knowledge/doc-sync-map.md, knowledge/log.md]
success: Trigger row exists for RecoveryFlow paths; log has dated entry
verification: pnpm verify:docs

## Next

    Plan: <project>/.cursor/plans/<slug>.plan.md
    Next:
    - (default) /andx-execute
    - /andx-execute-and-review
    - /andx-execute-and-deploy
    - /andx-execute-review-and-deploy
    Reply go → run default on this plan.
```

## Frontmatter fields

| Field | Required | Values |
|-------|----------|--------|
| `name` | yes | Human title |
| `overview` | yes | One sentence |
| `andx_ready` | yes | `true` when structured steps present |
| `domain_grilled` | yes | `true` \| `skipped` |
| `design_pass` | when Phase 1.5 applies | `true` \| `skipped` |
| `workstream` | yes | `code` \| `docs` \| `mixed` — drives TDD vs doc-verify in `/andx-execute` |
| `pipeline_stage` | when OKF layout present | ICM stage id from `ROUTING.md` (e.g. `03-build`, `02-draft`) |
| `knowledge_refs` | when OKF layout present | Bracket list of `knowledge/` paths cited by this plan (must include all `design_refs`) |
| `design_refs` | when Phase 1.5 ran | Bracket list of `knowledge/apis/*.md` and `knowledge/modules/*.md` |
| `companion_skills` | when companion skills invoked | Bracket list, e.g. `[api-design, codebase-design, accessibility]` |
| `stack` | no | `react-next` \| `react` \| `next` \| `none` — drives `REACT_STACK` in `/andx-execute` (`none` disables) |
| `source` | yes | `thread` \| `plan-mode` \| issue URL |
| `todos` | no | Cursor todos; execution steps live in body |
| `mr_branch` | for `--mr` | Reviewer-facing remote branch the run may push to (never `andx/exec-*`) |
| `mr_iids` | no | Bracket list of existing MR/PR ids the run may update |
| `base_sha` | for `--mr` stacks | Base commit; findings outside `base_sha..head` are rejected |
| `isProject` | yes | `false` for feature plans |

## Step block fields

Each step is a `### step-N — Title` heading followed by key-value lines:

| Key | Required | Notes |
|-----|----------|-------|
| `kind` | yes | `backend` \| `ui` \| `mixed` \| `docs` |
| `depends` | yes | `[]` or `[step-1, step-2]` |
| `touch` | yes | Bracket list of path prefixes, or `unknown` |
| `success` | yes | Falsifiable success criterion |
| `verification` | yes | Exact shell command or test identifier |
| `seams` | code steps | Bracket list of agreed public interfaces tests may target, e.g. `[POST /refunds, RefundService.request]`; worker runs `tdd` only at these |
| `parallel_safe_with` | no | `[step-N, …]` when explicitly parallel-safe |

**`kind: docs` rules:**

- `touch` lists doc paths (`docs/`, `knowledge/`), optionally source paths read for accuracy
- `verification` is usually `pnpm verify:docs` / `npm run verify:docs` / `node scripts/verify-docs.mjs`
- No Red/Green TDD loop in `/andx-execute` — implement → run verifier → gate

Step ids must match `step-\d+` (e.g. `step-1`, `step-2`).

## Parsing rules (`/andx-execute` Orchestrator)

1. Prefer plans with `andx_ready: true`.
2. Parse `workstream`, `pipeline_stage`, `knowledge_refs`, `design_refs`, `companion_skills`, and `stack` from frontmatter when present.
3. When `workstream: docs` or all steps are `kind: docs`, set **`DOCS_ONLY`** for worker (skip TDD; doc verifier in Phase 3).
4. Parse each `### step-N` block into the verification table.
5. Missing `depends` on step-N (N>1) → treat as `depends: [step-{N-1}]` (sequential chain).
6. Missing `kind` → ask once; default `backend` only if user confirms.
7. `touch: unknown` in a wave → force sequential execution (`/andx-schedule` uses same rule).
8. Topological sort on `depends` → log computed waves; with EXEC-MATRIX, `/andx-execute` may spawn parallel workers per wave.

## Wave computation

```
Wave 1: all steps with depends: []
Wave 2: steps whose depends are satisfied by Wave 1
…
```

Within a wave, steps with disjoint `touch` sets may run in parallel when `/andx-schedule` writes EXEC-MATRIX (`max_parallel` default 2). See [/andx-schedule](../andx-schedule/SKILL.md).

## Slug naming

- kebab-case from feature name: `buyer-refund-request`
- Avoid collisions: append `-2` if file exists
- Path: `.cursor/plans/<slug>.plan.md` relative to the **project workspace root** only

## Git / repo hygiene

- Default: ephemeral plans → add `.cursor/` (or at least `.cursor/plans/`) to the project's `.gitignore` if not already present.
- Commit a plan only when the user explicitly wants it tracked (shared handoff, team execution).
- Do not store plans in the user-global `~/.cursor/` tree.
- Never stage `.cursor/**` unless the user explicitly asks to track the plan.

## Session-end Next (required in every plan file)

Every written plan **must** include a trailing `## Next` section matching the chat Next block (plan path + andx-execute* options + `go` contract). See SKILL.md Phase 3 hard gate. Planner must also print that block in the chat reply; writing the file alone is not enough.
