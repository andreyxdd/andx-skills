# Andx plan fields and parsing

Read by `/andx-execute`, `/andx-schedule`, and `/andx-plan`. Templates: [PLAN-FORMAT.md](./PLAN-FORMAT.md).

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

## Parsing rules

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

