# Andx Plan Format

Execution-ready plans for `/andx-execute`. Written only to **`<project-root>/.cursor/plans/<slug>.plan.md`** — workspace root must be the target repo. Never `~/.cursor/plans`.

## Full template

```markdown
---
name: Human-readable title
overview: One sentence describing outcome
andx_ready: true
domain_grilled: true
design_pass: true
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

- `/andx-execute` on this plan
- (optional, later) `/andx-schedule` then `/andx-execute` for parallel waves
```

## Frontmatter fields

| Field | Required | Values |
|-------|----------|--------|
| `name` | yes | Human title |
| `overview` | yes | One sentence |
| `andx_ready` | yes | `true` when structured steps present |
| `domain_grilled` | yes | `true` \| `skipped` |
| `design_pass` | when Phase 1.5 applies | `true` \| `skipped` |
| `pipeline_stage` | when OKF layout present | ICM stage id from `ROUTING.md` (e.g. `03-build`, `02-draft`) |
| `knowledge_refs` | when OKF layout present | Bracket list of `knowledge/` paths cited by this plan (must include all `design_refs`) |
| `design_refs` | when Phase 1.5 ran | Bracket list of `knowledge/apis/*.md` and `knowledge/modules/*.md` |
| `companion_skills` | when companion skills invoked | Bracket list, e.g. `[api-design, design-an-interface, accessibility]` |
| `stack` | no | `react-next` \| `react` \| `next` \| `none` — drives `REACT_STACK` in `/andx-execute` (`none` disables) |
| `source` | yes | `thread` \| `plan-mode` \| issue URL |
| `todos` | no | Cursor todos; execution steps live in body |
| `isProject` | yes | `false` for feature plans |

## Step block fields

Each step is a `### step-N — Title` heading followed by key-value lines:

| Key | Required | Notes |
|-----|----------|-------|
| `kind` | yes | `backend` \| `ui` \| `mixed` |
| `depends` | yes | `[]` or `[step-1, step-2]` |
| `touch` | yes | Bracket list of path prefixes, or `unknown` |
| `success` | yes | Falsifiable success criterion |
| `verification` | yes | Exact shell command or test identifier |
| `parallel_safe_with` | no | `[step-N, …]` when explicitly parallel-safe |

Step ids must match `step-\d+` (e.g. `step-1`, `step-2`).

## Parsing rules (`/andx-execute` Orchestrator)

1. Prefer plans with `andx_ready: true`.
2. Parse `pipeline_stage`, `knowledge_refs`, `design_refs`, `companion_skills`, and `stack` from frontmatter when present.
3. Parse each `### step-N` block into the verification table.
4. Missing `depends` on step-N (N>1) → treat as `depends: [step-{N-1}]` (sequential chain).
5. Missing `kind` → ask once; default `backend` only if user confirms.
6. `touch: unknown` in a wave → force sequential execution (future `/andx-schedule` uses same rule).
7. Topological sort on `depends` → log computed waves in orchestrator progress (single worker today).

## Wave computation (informational)

```
Wave 1: all steps with depends: []
Wave 2: steps whose depends are satisfied by Wave 1
…
```

Within a wave, steps with disjoint `touch` sets may run in parallel when `/andx-schedule` sets `max_parallel > 1` (future).

## Slug naming

- kebab-case from feature name: `buyer-refund-request`
- Avoid collisions: append `-2` if file exists
- Path: `.cursor/plans/<slug>.plan.md` relative to the **project workspace root** only

## Git / repo hygiene

- Default: ephemeral plans → add `.cursor/plans/` to the project's `.gitignore` if not already present.
- Commit a plan only when the user explicitly wants it tracked (shared handoff, team execution).
- Do not store plans in the user-global `~/.cursor/` tree.
