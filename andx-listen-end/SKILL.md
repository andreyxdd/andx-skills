---
name: andx-listen-end
description: "/andx-listen-end: end listen mode, write docs/intake/YYYY-MM-DD-listen.md, then start andx-plan grilling on it. Use for \"stop listen\"."
---
# Andx Listen End

Only clean exit from [/andx-listen-start](../andx-listen-start/SKILL.md). Write the session intake, then plan.

**Standalone.** No worktree or HARNESS. After the file is written, follow [/andx-plan](../andx-plan/SKILL.md) from Phase 0.

## When

- `/andx-listen-end`
- **stop listen**

**Not for:** confirming a dump (that is listen-start). Do not call this until the user ends the listen session.

## Workflow

### 1. Write intake file

In the **current project workspace** (not `andx-skills` unless that is the workspace):

1. Create `docs/intake/` if missing.
2. Write `docs/intake/YYYY-MM-DD-listen.md` (today’s date). If that path exists, use `YYYY-MM-DD-listen-2.md` (increment).

Fill **all** sections from the **whole** listen session, not the last message only:

```markdown
# Listen intake — YYYY-MM-DD

## Locked facts

-

## Open questions

-

## Tasks for the agent

-

## Research requests

-

## Parked decisions / contradictions

-

## Corrections

-
```

- **Locked facts** — decisions and product statements that were confirmed.
- **Open questions** — unanswered forks (including items that stayed Parked).
- **Tasks for the agent** — work the user assigned (PRD, КП, implement, etc.).
- **Research requests** — queued research, still not started.
- **Parked decisions / contradictions** — later messages that overrode earlier ones; leftover conflicts.
- **Corrections** — explicit “that was wrong, this instead” over the session.

Empty section → write `None.` Do not invent. No secrets (tokens, passwords, env values).

### 2. Start /andx-plan

Immediately follow [andx-plan/SKILL.md](../andx-plan/SKILL.md) from **Phase 0**.

- Domain brief = the intake file just written.
- Cite it in plan `knowledge_refs`.
- **Phase 1 required** — grill the summary deep. Do not skip grill. Do not jump to writing the plan file until the user confirms domain stable.
- If `knowledge/` is missing, suggest `/andx-init` once (non-blocking), same as andx-plan.

## Anti-patterns

- Ending listen without writing the intake file
- Writing the intake inside `andx-skills` when the dump was about another project
- Skipping andx-plan Phase 1 grill
- Starting queued research/tasks instead of planning
- Asking questions before the file exists (grill starts after the file)
