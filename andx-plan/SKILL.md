---
name: andx-plan
description: Plans features for andx execution — grill-with-docs domain interview plus steps with depends, touch, and verification criteria. Writes project-local .cursor/plans/*.plan.md only (never ~/.cursor/plans). Use for /andx-plan, "plan for andx-execute", or after Plan mode when execution metadata is missing.
---

# Andx Plan

Bridge from **idea** to **`/andx-execute`**: grill domain terms, then write an execution-ready plan at **`<project>/.cursor/plans/<slug>.plan.md`** (workspace root must be the target repo).

## When to use

- User invokes `/andx-plan` or asks to plan for andx execution
- After Cursor Plan mode when steps lack `depends`, `touch`, or verification commands
- After `/grill-with-docs` when domain is settled but execution steps are not written yet
- Before `/andx-execute` or `/andx-execute-and-deploy`

**Not for:** running tests, editing application source, or deploying.

## Required companion skills

| Skill | Role |
|-------|------|
| [/grill-with-docs](../grill-with-docs/SKILL.md) | Domain interview rules (Phase 1) |
| [/andx-init](../andx-init/SKILL.md) | Scaffold OKF + ICM when `knowledge/` missing |
| [PLAN-FORMAT.md](./PLAN-FORMAT.md) | Output template and parsing rules |

## Workflow overview

```
Phase 0 — Anchor (read OKF + ICM + legacy CONTEXT, decide domain grill)
Phase 1 — Domain grill (when needed; grill-with-docs)
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
4. Decide domain grill:

| Situation | Phase 1 |
|-----------|---------|
| Domain fuzzy, no glossary/CONTEXT coverage, or term conflicts | **Run** full domain grill |
| Domain already grilled; glossary + stage CONTEXT cover scope | **Skip** — set `domain_grilled: skipped` in plan frontmatter |

4. Record active stage id (e.g. `03-build`) for plan frontmatter `pipeline_stage`.
5. Propose plan slug (kebab-case) → output path `.cursor/plans/<slug>.plan.md`.
6. Confirm slug with user before Phase 2 if ambiguous.

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

## Phase 2 — Execution grill (always)

One question at a time. Build the step list before writing the file.

Per step, resolve:

| Field | Required |
|-------|----------|
| `step-N` id | yes |
| Title | yes |
| `kind` | `backend` \| `ui` \| `mixed` |
| `depends` | `[]` or `[step-N, …]` |
| `touch` | path prefixes from repo exploration, or `unknown` |
| `success` | one falsifiable sentence |
| `verification` | exact command or test name |
| `parallel_safe_with` | optional — only when user wants parallelism |

Rules:

- Explore the repo to propose realistic `touch` paths — do not default every step to `unknown`.
- Multi-step plans must have explicit `depends`.
- 1–2 step plans still include `depends` and `touch` (may be trivial).
- Present the full step list for user approval before Phase 3.

---

## Phase 3 — Write plan file

Write `.cursor/plans/<slug>.plan.md` using [PLAN-FORMAT.md](./PLAN-FORMAT.md).

Include frontmatter:

- `pipeline_stage` — active ICM stage id from `ROUTING.md` (e.g. `03-build`)
- `knowledge_refs` — bracket list of `knowledge/` paths the plan depends on
- `stack` — when detected or confirmed in Phase 0 (`react-next`, `react`, `next`, or `none`)

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

## Optional pairing

| Situation | Skill |
|-----------|--------|
| No OKF layout yet | `/andx-init` |
| Execute the plan | `/andx-execute` |
| Execute + review gate | `/andx-execute-and-review` |
| Execute + deploy | `/andx-execute-and-deploy` |
| Domain only, no execution steps yet | `/grill-with-docs` |
| Plan unclear, no domain doc | `/grill-me` |
| Parallel waves (future) | `/andx-schedule` |
