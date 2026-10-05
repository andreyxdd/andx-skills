---
name: andx-execute-and-review
description: Executes an approved plan in an isolated worktree, then gates merge behind independent adversarial review (bugbot + security + ponytail always; scoped audit/React/a11y conditional). Worker fixes blockers in a bounded loop before merge. Use for /andx-execute-and-review or "execute and review".
---

# Andx Execute and Review

Worker implements in worktree; **blind reviewers** gate merge to `TARGET_BRANCH`.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), [/andx-execute](../andx-execute/SKILL.md) § Worker. Reviewer roster + severity → SKILL-MAP. Artifact → [FINDINGS-SCHEMA.md](../andx-mr-review/FINDINGS-SCHEMA.md).

## When

Plan ready; need second pass before land. Review + ship → `/andx-execute-review-and-deploy`. Deploy-only → `/andx-execute-and-deploy`. No gate → `/andx-execute`.

## Workflow

```
A–B Worker Phases 0–4 on EXEC_BRANCH (no merge)
C   Parallel fresh reviewers (HARNESS + SKILL-MAP)
D   Union verdicts — BLOCK if any Critical/High
E   Resume worker ≤3 rounds → re-review
F   PASS → REVIEW-ARTIFACT → orch Step 4 concurrent-merge + cleanup
```

## Phase A–B — Execute

[/andx-execute](../andx-execute/SKILL.md) § Orchestrator preflight + spawn. Worker Phases 0–4 → handoff. **Do not merge.** Worker fail → stop (no review).

## Phase C — Review (parallel, blind)

Fresh agents only; read-only; adversarial. Give: `git diff TARGET_BRANCH..EXEC_BRANCH`, plan (`touch`/`success`/`verification`/`design_refs`), verification evidence.

**Always:** Reviewers 1–3 (bugbot, security, ponytail-review) per SKILL-MAP + HARNESS.
**Conditional:** 4–7 per SKILL-MAP triggers.
**Karpathy on bugbot results:** surgical scope HIGH; speculative abstraction MEDIUM.
**Harness jargon (always, orch or bugbot Custom Instructions):** flag `ponytail:` /
`andx:` / skill names / `andx/exec-*` pins in source or shipped runbooks as **MEDIUM**
per [CODE-COMMENTS.md](../andx-execute/CODE-COMMENTS.md) — must read for a first-time reviewer.

**Workspace review gates (any repo):** Before spawning reviewers, if the workspace
(or parent multi-repo map) has `agents/rules/README.md`, load rules listed under
**review** / files matching `*-review-gates.md` whose scope matches `touch` paths.
Pass gate titles into Bugbot/security **Custom Instructions**. Do not hardcode
product rules in this skill — same discovery contract as
[andx-mr-review](../andx-mr-review/SKILL.md) §5. Violated gates → VERDICT blockers
at the severity the gate file defines.

### Verdict contract

```
## VERDICT
status: BLOCK | PASS
blockers:
  - [CRITICAL|HIGH] <file:line> — <one line>
advisory:
  - [MEDIUM|LOW] <file:line> — <one line>
```

Missing/malformed VERDICT → **BLOCK** (re-request once).

### REVIEW-ARTIFACT (on PASS, before merge)

Parent may write/commit **only** `.cursor/reviews/<plan-slug>.json` on `EXEC_BRANCH` (or resume worker to do it) — not app source. Schema: FINDINGS-SCHEMA. Commit `chore(review): add REVIEW-ARTIFACT for <plan-slug>`; then Phase F.

## Phase D–E — Verdict + fix loop

**BLOCK** = any Critical/High from **any** reviewer. Reviewer 7 (UX/API) is advisory unless paired with another High. Medium → fix or justify-and-defer. Low → advisory.

Resume worker (`resume=<id>`) with union blockers; Phase 3 on EXEC_BRANCH; re-run always 1–3 + applicable conditionals. Max **3** rounds → escalate, **no merge**.

## Phase F — Merge

Orchestration Step 4 (concurrent-merge). If Step 4 conflict worker changed product source, re-run always reviewers 1-3 before TARGET merge. Clean integrate → no extra review. Then post-merge Phase 3 → cleanup evidence.

## Definition of done

Worker pass; always Reviewers 1–3 PASS; conditionals 4–7 PASS when their gates ran; no open High; merged + post-merge green + cleanup.

## Anti-patterns

- Reviewer shares worker context
- Merge with open High
- Parent “just fixes” source
- Whole-repo ponytail-audit (scope to `touch`)
- Treating `shrink:` as blocker
