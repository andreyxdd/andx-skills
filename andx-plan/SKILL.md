---
name: andx-plan
description: Plans features for andx execution — grill-with-docs domain interview plus steps with depends, touch, and verification criteria. Writes project-local .cursor/plans/*.plan.md only (never ~/.cursor/plans). Use for /andx-plan, "plan for andx-execute", or after Plan mode when execution metadata is missing.
---

# Andx Plan

Bridge from **idea** to **`/andx-execute`**: grill domain terms, then write an execution-ready plan at **`<project>/.cursor/plans/<slug>.plan.md`** (workspace root must be the target repo).

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

## When to use

- User invokes `/andx-plan` or asks to plan for andx execution
- After Cursor Plan mode when steps lack `depends`, `touch`, or verification commands
- After `/grill-with-docs` when domain is settled but execution steps are not written yet
- Before `/andx-execute` or `/andx-execute-and-deploy`

**Not for:** running tests, editing application source, or deploying.

**First-time CI/CD:** use [/andx-deploy-init](../andx-deploy-init/SKILL.md), which grills production decisions, requires manual infrastructure confirmation, then routes the plan to `/andx-execute-and-review`.

## Required companion skills

| Skill | Role |
|-------|------|
| [/grill-with-docs](../grill-with-docs/SKILL.md) | Domain interview rules (Phase 1) |
| [/andx-init](../andx-init/SKILL.md) | Scaffold OKF + ICM when `knowledge/` missing |
| [PLAN-FORMAT.md](./PLAN-FORMAT.md) | Output template and parsing rules |
| `~/.cursor/skills/design-an-interface/SKILL.md` | Phase 1.5 — module boundary (conditional) |
| `~/.cursor/skills/api-design/SKILL.md` | Phase 1.5 — HTTP/GraphQL contract (conditional) |
| `~/.cursor/skills/create-mcp-server/SKILL.md` | Phase 1.5 — MCP tool surface (conditional) |
| `~/.cursor/skills/accessibility/SKILL.md` | Phase 2 — a11y criteria on UI steps (conditional) |
| `~/.cursor/skills/impeccable/SKILL.md` | Phase 2 — UX notes on UI steps (conditional) |

Upstream (see SKILL-MAP): `write-a-prd` before greenfield planning; `grill-me` blocks when scope still hand-wavy after Phase 0.

## Workflow overview

```
Phase 0 — Anchor (read OKF + ICM + legacy CONTEXT, decide domain grill)
Phase 1 — Domain grill (when needed; grill-with-docs)
Phase 1.5 — Design pass (conditional; design-an-interface, api-design, create-mcp-server)
Phase 2 — Execution grill (always; steps, depends, touch)
Phase 3 — Write .cursor/plans/<slug>.plan.md
```

Handoff: **`/andx-execute`** on the plan path. Optional later: **`/andx-schedule`** for `EXEC-MATRIX.md` when parallel waves are needed.

---

## Phase 0 — Anchor

0. **Workspace gate (before any reads or writes):**
   - Plans live only under the **target project's** `.cursor/plans/`. Never write to `~/.cursor/plans`.
   - If workspace root is home, empty window, or not the repo you are planning for → call **`move_agent_to_root`** with the project path first. Do not plan from home.
   - After move, confirm workspace root contains the app (e.g. `package.json`, `go.mod`, or known repo marker). If ambiguous, ask once.
   - Create `.cursor/plans/` in the project if missing. Ensure `.cursor/plans/` is in `.gitignore` unless the user wants plans committed (default: ephemeral → gitignore).

1. Read OKF + ICM anchors (when present):
   - `IDENTITY.md` — audience, constraints, non-goals
   - `ROUTING.md` — resolve **active pipeline stage** (link target under `pipeline/<stage>/`)
   - `knowledge/index.md` — concept bundle entry point
   - Active stage `pipeline/<stage>/CONTEXT.md` (Inputs / Process / Outputs)
   - Legacy `CONTEXT.md` / `CONTEXT-MAP.md`, relevant `docs/adr/`, thread text, or Plan mode draft
2. If `knowledge/` is **missing**, suggest **`/andx-init`** once (pick preset: app | data | content). Do not block planning if user declines — fall back to legacy `CONTEXT.md` only.
3. **Detect stack** — when `package.json` lists `react` or `next`, propose `stack: react-next` (or `react` / `next`) for plan frontmatter; use `stack: none` when user confirms non-React scope.
4. **Detect workstream** — propose `workstream` for plan frontmatter:

| Signal | `workstream` |
|--------|--------------|
| Code feature (default) | `code` |
| Docs/diagrams/OKF only, no `src/` changes | `docs` |
| Feature + matching docs/runbooks | `mixed` |

When `workstream: docs`, set `stack: none` unless code steps are also planned.

5. **Detect doc verifier** — when `package.json` scripts include `verify:docs` or `scripts/verify-docs.mjs` exists, default doc-step `verification` to that command (e.g. `pnpm verify:docs`).

6. Decide domain grill:

| Situation | Phase 1 |
|-----------|---------|
| Domain fuzzy, no glossary/CONTEXT coverage, or term conflicts | **Run** full domain grill |
| Domain already grilled; glossary + stage CONTEXT cover scope | **Skip** — set `domain_grilled: skipped` in plan frontmatter |

7. Record active stage id (e.g. `03-build`) for plan frontmatter `pipeline_stage`.
8. Propose plan slug (kebab-case) → output path `.cursor/plans/<slug>.plan.md`.
9. Confirm slug with user before Phase 2 if ambiguous.

When scope matches a **plan archetype** below, propose its step skeleton in Phase 2 instead of inventing from scratch.

---

## Plan archetypes

Use when the user's ask clearly fits. Adapt `touch` paths from repo exploration.

### Mirror-doc (document X like existing Y)

When a canonical diagram/feature doc exists and a sibling flow needs the same shape.

Typical steps:

1. Read mirror doc + source code for the new flow (`kind: docs`)
2. Write new diagram/feature doc matching sections/phases (`kind: docs`)
3. Update `knowledge/doc-sync-map.md` trigger row (`kind: docs`)
4. Cross-link glossary, module stub, runbook Notes (`kind: docs`)
5. `pnpm verify:docs` (or repo equivalent) (`kind: docs`)

### OKF hardening (brownfield bundle cleanup)

When `knowledge/` exists but is thin: empty glossary, missing module stubs, stale ROUTING.

Typical steps:

1. Align `ROUTING.md` + `IDENTITY.md` with reality (`kind: docs`)
2. Expand `knowledge/index.md` navigation (`kind: docs`)
3. Glossary ≥10–15 terms + `knowledge/log.md` entry (`kind: docs`)
4. Module stubs in `knowledge/modules/` (`kind: docs`)
5. Runbook Notes → diagram links; extend `doc-sync-map` (`kind: docs`)
6. Doc verifier green (`kind: docs`)

Skip Phase 1.5 (api-design) for both archetypes unless the plan also adds HTTP surface.

---

## Phase 1 — Domain grill (when needed)

Follow [/grill-with-docs](../grill-with-docs/SKILL.md) `<what-to-do>`:

- One question at a time; provide your recommended answer.
- Explore the codebase instead of asking when the answer is in code.
- **andx-plan owns knowledge writes** — update `knowledge/domain/glossary.md` and related concept files under `knowledge/` (not grill-with-docs directly). Append material changes to `knowledge/log.md`.
- Keep legacy `CONTEXT.md` glossary in sync only when the repo still uses it and has no `knowledge/` yet.
- Offer ADRs only when hard to reverse, surprising, and a real trade-off.

Collect **`knowledge_refs`** — paths to concepts cited by this plan (e.g. `knowledge/domain/glossary.md`, `knowledge/apis/checkout.md`). Use in Phase 3 frontmatter.

Exit when the user confirms domain scope is stable.

---

## Phase 1.5 — Design pass (conditional)

Run when **any** of:

- Plan adds a **new module** or non-obvious seam (`kind: backend` step with new package/dir)
- Plan adds or changes **HTTP/GraphQL surface** (routes, handlers, OpenAPI, schema files)
- User asks to "design API" / "shape interface"
- No existing `knowledge/apis/` or `knowledge/modules/` doc covers the scope

**Skip** when extending a documented API/module with the same contract → set `design_pass: skipped` in plan frontmatter.

Do **not** duplicate skill prose — read and delegate.

### Module shape unclear

Read `~/.cursor/skills/design-an-interface/SKILL.md`:

- **Default:** produce 3 designs sequentially in-thread (skill Steps 1–5)
- **User gate:** after requirements, offer parallel subagents for high-stakes work; spawn 3–4 `Task` agents only when user confirms
- **Capture:** `knowledge/modules/<slug>.md` (`type: module`); append `knowledge/log.md`
- First doc? Copy from `andx-init/templates/app/knowledge/modules/_TEMPLATE.md`

### HTTP/GraphQL contract

Read `~/.cursor/skills/api-design/SKILL.md`:

- After interface pick when both apply; alone when endpoint extends a known module
- **Capture:** `knowledge/apis/<slug>.md` (`type: api`); link in plan — do not duplicate in plan body
- First doc? Copy from `andx-init/templates/app/knowledge/apis/_TEMPLATE.md`

### MCP tool surface

Read `~/.cursor/skills/create-mcp-server/SKILL.md` → `knowledge/apis/mcp-<slug>.md`.

Record invoked skills in plan frontmatter `companion_skills`. Add paths to `design_refs` and `knowledge_refs`.

Exit when user confirms design is stable → Phase 2 with concrete `touch` and verification from the contract.

---

## Phase 2 — Execution grill (always)

One question at a time. Build the step list before writing the file.

Per step, resolve:

| Field | Required |
|-------|----------|
| `step-N` id | yes |
| Title | yes |
| `kind` | `backend` \| `ui` \| `mixed` \| `docs` |
| `depends` | `[]` or `[step-N, …]` |
| `touch` | path prefixes from repo exploration, or `unknown` |
| `success` | one falsifiable sentence |
| `verification` | exact command or test name |
| `parallel_safe_with` | optional — only when user wants parallelism |

Rules:

- Explore the repo to propose realistic `touch` paths — do not default every step to `unknown`.
- **`kind: docs`** — `touch` is doc paths (`docs/`, `knowledge/`); `verification` is doc verifier or link check; no TDD; read [doc-sync-map](knowledge/doc-sync-map.md) tiers before writing.
- Multi-step plans must have explicit `depends`.
- 1–2 step plans still include `depends` and `touch` (may be trivial).
- Present the full step list for user approval before Phase 3.
- **UI steps:** when a11y matters, read `~/.cursor/skills/accessibility/SKILL.md` and bake criteria into `success`/`verification`; add `accessibility` to `companion_skills`.
- **UI/UX-heavy steps:** note impeccable intent in step title or success; add `impeccable` to `companion_skills` when applicable.
- When Phase 1.5 ran, step `success` must reference contract concretely (e.g. `POST /v1/refunds returns 201 with Location`).

---

## Phase 3 — Write plan file

Write `.cursor/plans/<slug>.plan.md` using [PLAN-FORMAT.md](./PLAN-FORMAT.md).

Include frontmatter:

- `pipeline_stage` — active ICM stage id from `ROUTING.md` (e.g. `03-build`)
- `workstream` — `code` \| `docs` \| `mixed` (from Phase 0)
- `knowledge_refs` — bracket list of `knowledge/` paths the plan depends on (must include all `design_refs`)
- `design_pass` — `true` \| `skipped`
- `design_refs` — bracket list of `knowledge/apis/*.md` and `knowledge/modules/*.md` when Phase 1.5 ran
- `companion_skills` — skills actually invoked (e.g. `[api-design, design-an-interface]`)
- `stack` — when detected or confirmed in Phase 0 (`react-next`, `react`, `next`, or `none`)

When Phase 1.5 produced artifacts, add optional body section `## Design contract` (links only — no duplicate of knowledge files). See [PLAN-FORMAT.md](./PLAN-FORMAT.md).

Do not write the file until the user approves the step list from Phase 2.

End the plan body with:

```markdown
## Next

- `/andx-execute` on this plan
- (optional, later) `/andx-schedule` then `/andx-execute` for parallel waves
```

Report the absolute plan path in the reply.

---

## Suggested usage

```text
/andx-plan Add buyer refund request flow
  → domain grill if needed
  → execution grill
  → .cursor/plans/buyer-refund-request.plan.md

/andx-execute @.cursor/plans/buyer-refund-request.plan.md
```

---

## Anti-patterns

- Writing plans to `~/.cursor/plans` or planning from home when the target is a project repo
- Skipping `move_agent_to_root` when workspace root ≠ target project
- Implementation details in glossary or pipeline CONTEXT
- Expecting grill-with-docs to write `knowledge/` — andx-plan owns those writes
- Steps without falsifiable `success` or `verification`
- `touch: unknown` on every step when codebase exploration could resolve paths
- Writing the plan file before user approves the step list
- Skipping `depends` on multi-step plans
- Duplicating grill-with-docs prose — link and delegate instead
- Duplicating api-design or design-an-interface prose in the plan — link `knowledge/` files
- Spawning parallel design subagents without user confirmation
- Auto-invoking every companion skill on every plan
- `kind: backend` on pure documentation steps
- Skipping `doc-sync-map` + `knowledge/log.md` on plans that add or reshape docs

## Optional pairing

| Situation | Skill |
|-----------|--------|
| First-time CI/CD bootstrap | `/andx-deploy-init` |
| No OKF layout yet | `/andx-init` |
| Execute the plan | `/andx-execute` |
| Execute + review gate | `/andx-execute-and-review` |
| Execute + deploy | `/andx-execute-and-deploy` |
| Domain only, no execution steps yet | `/grill-with-docs` |
| Plan unclear, no domain doc | `/grill-me` |
| Parallel waves (future) | `/andx-schedule` |
