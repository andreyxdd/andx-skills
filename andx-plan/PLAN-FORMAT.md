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
    Fresh chat: /andx-execute <project>/.cursor/plans/<slug>.plan.md
    Reply go → run default on this plan.
```

Outside the plan file: mark exactly one `(default)` per andx-plan session-end rules; chat reply must end with the same Next block. The `Fresh chat` line names the `(default)` skill and the absolute plan path (Claude Code: run it after `/clear`); `go` is the same-thread fallback that keeps the grill context.

## Docs workstream (delta from the template above)

- Frontmatter: `workstream: docs`, `domain_grilled: skipped`, `design_pass: skipped`, `stack: none`, `knowledge_refs` includes `knowledge/doc-sync-map.md`, no `design_refs`.
- Every step: `kind: docs`, no `seams`, `touch` = doc paths (plus source paths read for accuracy), `verification` = the repo doc verifier (e.g. `pnpm verify:docs`).
- Typical last step updates `knowledge/doc-sync-map.md` and `knowledge/log.md`.

Field reference and parsing rules: [PARSE.md](./PARSE.md).

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

Every written plan **must** include a trailing `## Next` section matching the chat Next block (plan path + andx-execute* options + `Fresh chat` line + `go` contract). See SKILL.md Phase 3 hard gate. Planner must also print that block in the chat reply; writing the file alone is not enough.
