---
name: andx-plan
description: "/andx-plan: turn an idea into an execution-ready .cursor/plans/<slug>.plan.md (grill, steps with depends/touch/verification, Next menu). Use for \"plan this feature\" or planning for andx-execute."
---
# Andx Plan

Idea → execution-ready **`<project>/.cursor/plans/<slug>.plan.md`**.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Format: [PLAN-FORMAT.md](./PLAN-FORMAT.md)

**Not for:** tests, source edits, deploy. First CI/CD → [/andx-deploy-init](../andx-deploy-init/SKILL.md).

Companions: `/grilling`, `/andx-init`, Phase 1.5 design/api/mcp skills, a11y/impeccable on UI — see SKILL-MAP. Do not duplicate their prose.

```
Phase 0 Anchor → 1 Domain grill? → 1.5 Design? → 2 Execution grill → 3 Write plan → Next menu
```

---

## Phase 0 — Anchor

1. **Workspace gate:** plans only under target project `.cursor/plans/`. Never `~/.cursor/plans`. If root ≠ target repo → `move_agent_to_root` first. Ensure `.cursor/plans/` exists (gitignore by default).
2. **Plan-mode upgrade:** if `.cursor/plans/*.plan.md` or Cursor Plan draft exists but lacks `depends`/`touch`/`verification`, upgrade in place to PLAN-FORMAT — skip domain grill unless gaps.
3. Read OKF/ICM when present: `IDENTITY.md`, `ROUTING.md`, `knowledge/index.md`, active `pipeline/<stage>/CONTEXT.md`, legacy CONTEXT/ADRs/thread.
4. **Workspace rules:** per [workspace rules](../andx-orchestration/WORKSPACE-RULES.md) on the likely `touch`. Bake constraints into steps (`depends`/`success`/`verification`) — do not leave cross-repo sync implicit.
5. Missing `knowledge/` → suggest `/andx-init` once (non-blocking).
6. Detect `stack`, `workstream` (`code`|`docs`|`mixed`), doc verifier, whether Phase 1 needed, `pipeline_stage`, slug.
7. Confirm slug if ambiguous. Propose archetype skeleton when fit (mirror-doc / OKF hardening — see below).

## Plan archetypes

**Mirror-doc:** read mirror + code → write sibling doc → update `doc-sync-map` → cross-links → doc verifier (`kind: docs`).

**OKF hardening:** align ROUTING/IDENTITY → index → glossary+log → module stubs → runbook/doc-sync → verifier. Skip Phase 1.5 unless adding HTTP.

## Phase 1 — Domain grill (when needed)

Grill in **rounds** per `/grilling`: ask the whole frontier (every question whose prerequisites are settled) at once, numbered, each with your recommended answer worded so "yes" accepts it. Facts are your job (explore or spawn a read-only agent), decisions are the user's. **andx-plan owns** `knowledge/` writes + `knowledge/log.md`. Collect `knowledge_refs`. Exit when the frontier is empty and the user confirms.

## Phase 1.5 — Design (conditional)

New module / HTTP-GraphQL / MCP / user asks design. Skip if extending documented contract → `design_pass: skipped`.

New module or seam: read `~/.cursor/skills/codebase-design/DESIGN-IT-TWICE.md` (two or more radically different interfaces, compare on depth/leverage/locality, user picks). HTTP: api-design; MCP: create-mcp-server; capture under `knowledge/modules|apis/`; first doc copy from andx-init templates. Record `companion_skills` + `design_refs`.

## Phase 2 — Execution grill (always)

Same **rounds** as Phase 1. Per step: id, title, `kind`, `depends`, `touch`, `seams`, `success`, `verification`. Explore repo for real `touch` paths.

- **Vertical slices:** each step delivers one observable behavior end to end (schema + API + UI as needed). Never split by layer ("step-1 schema, step-2 API, step-3 UI").
- **Seams:** for `backend`/`ui`/`mixed` steps, agree the public interfaces the worker may test at (`tdd` tests only at agreed seams). One line each: what it catches, what it misses.
- UI: bake a11y/impeccable into success when needed.

Present full step list; **user approves before Phase 3**.

## Phase 3 — Write plan file

Write `.cursor/plans/<slug>.plan.md` per PLAN-FORMAT (frontmatter + steps). Absolute path in reply.

Ensure project `.gitignore` covers `.cursor/` or `.cursor/plans/` before writing; never commit `.cursor/**` unless user explicitly demands a tracked plan.

### Session-end Next + `go` (hard gate)

**Do not end the turn** after writing the plan without the Next block. Incomplete run = missing handoff.

Chat reply **must end** with (also mirror in plan `## Next`):

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

**`go` contract:** same thread, bare `go` / `Go` / `/go` → immediately Read `~/.cursor/skills/<default-skill>/SKILL.md` and follow it with this plan path (works for user-only skills too); do not re-ask Phase 2. `review` / `deploy` / skill name → matching option when unambiguous.

## Anti-patterns

- Plans in `~/.cursor/plans` or from home without `move_agent_to_root`
- Steps without falsifiable success/verification
- Horizontal (layer-by-layer) steps; code steps without `seams`
- One question per turn when several are already answerable (use rounds)
- `touch: unknown` when exploration could resolve
- Write file before step-list approval
- Duplicate companion skill prose into plan body
- Omit Next menu / plan path / `go` contract (silent end after write)
- Committing `.cursor/**` by default
