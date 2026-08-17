---
name: andx-plan
description: Plans features for andx execution — grill-with-docs domain interview plus steps with depends, touch, and verification criteria. Writes project-local .cursor/plans/*.plan.md only (never ~/.cursor/plans). Ends with a short Next menu; bare go runs the default next skill. Use for /andx-plan, "plan for andx-execute", or after Plan mode when execution metadata is missing.
---

# Andx Plan

Idea → execution-ready **`<project>/.cursor/plans/<slug>.plan.md`**.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Format: [PLAN-FORMAT.md](./PLAN-FORMAT.md)

**Not for:** tests, source edits, deploy. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md).

Companions: `/grill-with-docs`, `/andx-init`, Phase 1.5 design/api/mcp skills, a11y/impeccable on UI — see SKILL-MAP. Do not duplicate their prose.

```
Phase 0 Anchor → 1 Domain grill? → 1.5 Design? → 2 Execution grill → 3 Write plan → Next menu
```

---

## Phase 0 — Anchor

1. **Workspace gate:** plans only under target project `.cursor/plans/`. Never `~/.cursor/plans`. If root ≠ target repo → `move_agent_to_root` first. Ensure `.cursor/plans/` exists (gitignore by default).
2. **Plan-mode upgrade:** if `.cursor/plans/*.plan.md` or Cursor Plan draft exists but lacks `depends`/`touch`/`verification`, upgrade in place to PLAN-FORMAT — skip domain grill unless gaps.
3. Read OKF/ICM when present: `IDENTITY.md`, `ROUTING.md`, `knowledge/index.md`, active `pipeline/<stage>/CONTEXT.md`, legacy CONTEXT/ADRs/thread.
4. Missing `knowledge/` → suggest `/andx-init` once (non-blocking).
5. Detect `stack`, `workstream` (`code`|`docs`|`mixed`), doc verifier, whether Phase 1 needed, `pipeline_stage`, slug.
6. Confirm slug if ambiguous. Propose archetype skeleton when fit (mirror-doc / OKF hardening — see below).

## Plan archetypes

**Mirror-doc:** read mirror + code → write sibling doc → update `doc-sync-map` → cross-links → doc verifier (`kind: docs`).

**OKF hardening:** align ROUTING/IDENTITY → index → glossary+log → module stubs → runbook/doc-sync → verifier. Skip Phase 1.5 unless adding HTTP.

## Phase 1 — Domain grill (when needed)

Follow grill-with-docs; **andx-plan owns** `knowledge/` writes + `knowledge/log.md`. Collect `knowledge_refs`. Exit when user confirms domain stable.

## Phase 1.5 — Design (conditional)

New module / HTTP-GraphQL / MCP / user asks design. Skip if extending documented contract → `design_pass: skipped`.

Delegate to design-an-interface / api-design / create-mcp-server; capture under `knowledge/modules|apis/`; first doc copy from andx-init templates. Record `companion_skills` + `design_refs`.

## Phase 2 — Execution grill (always)

One Q at a time. Per step: id, title, `kind`, `depends`, `touch`, `success`, `verification`. Explore repo for real `touch` paths. UI: bake a11y/impeccable into success when needed. Present full step list; **user approves before Phase 3**.

## Phase 3 — Write plan file

Write `.cursor/plans/<slug>.plan.md` per PLAN-FORMAT (frontmatter + steps). Absolute path in reply.

### Session-end Next + `go` (required)

Chat reply **must end** with a short Next block (also mirror in plan `## Next`):

```text
Plan: <abs>/.cursor/plans/<slug>.plan.md
Next:
- (default) /andx-execute
- /andx-execute-and-review
- /andx-execute-and-deploy
- /andx-execute-review-and-deploy
Reply go → run default on this plan.
```

**Default picker (exactly one `(default)`):**
- User said review+deploy, or ship → `/andx-execute-review-and-deploy`
- User said deploy-only (no review) → `/andx-execute-and-deploy`
- User said review-only, or security/CI/prod-touching plan (no deploy) → `/andx-execute-and-review`
- Multi-wave (disjoint `touch`, deps allow ≥2 parallel) → offer `/andx-schedule` before execute (optional; not default unless user asked schedule)
- Else (incl. `workstream: docs`) → `/andx-execute`

**`go` contract:** same thread, bare `go` / `Go` / `/go` → immediately invoke the **default** skill with this plan path; do not re-ask Phase 2. `review` / `deploy` / skill name → matching option when unambiguous.

## Anti-patterns

- Plans in `~/.cursor/plans` or from home without `move_agent_to_root`
- Steps without falsifiable success/verification
- `touch: unknown` when exploration could resolve
- Write file before step-list approval
- Duplicate companion skill prose into plan body
- Skip Next menu / omit `go` contract
