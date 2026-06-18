# Andx Plan Format

Execution-ready plans for `/andx-execute`. Written only to **`<project-root>/.cursor/plans/<slug>.plan.md`** — workspace root must be the target repo. Never `~/.cursor/plans`.

## Full template

```markdown
---
name: Human-readable title
overview: One sentence describing outcome
andx_ready: true
domain_grilled: true
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
2. Parse each `### step-N` block into the verification table.
3. Missing `depends` on step-N (N>1) → treat as `depends: [step-{N-1}]` (sequential chain).
4. Missing `kind` → ask once; default `backend` only if user confirms.
5. `touch: unknown` in a wave → force sequential execution (future `/andx-schedule` uses same rule).
6. Topological sort on `depends` → log computed waves in orchestrator progress (single worker today).

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
