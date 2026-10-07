---
name: andx-listen-start
description: "/andx-listen-start: sticky listen mode; confirm each dump is in context, ask nothing, run no tools until /andx-listen-end. Use for \"just listen\" or \"confirm you have this\"."
---
# Andx Listen Start

Sticky **confirm-only** intake. Capture dumps. Do not interview, research, or implement.

**Standalone.** No worktree, `/andx-execute`, or HARNESS. Pair: [/andx-listen-end](../andx-listen-end/SKILL.md).

## When

- `/andx-listen-start`
- User says **Continue to listen to me**
- User says **DO NOT ASK ANYTHING JUST CONFIRM YOU HAVE THIS IN THE CONTEXT**

**Not for:** grilling, planning, research, edits. Those wait for `/andx-listen-end`.

## Persistence

ACTIVE every turn after invoke until `/andx-listen-end` or **stop listen**.

Stay in listen protocol even if this skill is not re-attached. If unsure whether still listening → still listening.

## Each user message

Recap **this message only**. Do not replay the whole session.

```text
In context. No questions.

**New:**
- …

**Queued:**
- …

**Parked:**
- …
```

Omit an empty section. No extra prose. No "listening." No follow-up questions.

| Section | What goes here |
|---------|----------------|
| **New** | Facts/decisions stated in this message |
| **Queued** | Asks to research, implement, grill, or run other skills — recorded, **not started** |
| **Parked** | Ambiguities and undecided forks in this message |

## Hard rules

- **No tools.** No Read, Write, Shell, search, MCP.
- **No questions.**
- **No edits, research, or other andx skills** (except listen-end, which exits).
- **Listen clause wins.** If the same message also says "ask questions" / "do research" / "implement", confirm + queue those asks. Do not do them.

## Exit

Only `/andx-listen-end` or **stop listen**. Then follow [andx-listen-end](../andx-listen-end/SKILL.md).
