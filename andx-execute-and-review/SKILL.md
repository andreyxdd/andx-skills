---
name: andx-execute-and-review
description: Executes an approved plan in an isolated worktree, then gates merge behind independent adversarial review (bugbot + security + ponytail always; scoped audit/React/a11y conditional). Worker fixes blockers in a bounded loop before merge. Use for /andx-execute-and-review or "execute and review".
---

# Andx Execute and Review

Worker implements in worktree; **blind reviewers** gate merge to `TARGET_BRANCH`.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), [/andx-execute](../andx-execute/SKILL.md) § Worker. Reviewer roster + severity → SKILL-MAP. Artifact → [FINDINGS-SCHEMA.md](../andx-pr-review/FINDINGS-SCHEMA.md).

## When

Plan ready; need second pass before land. Not deploy → `/andx-execute-and-deploy`. No gate → `/andx-execute`.

## Workflow

```
A–B Worker Phases 0–4 on EXEC_BRANCH (no merge)
C   Parallel fresh reviewers (HARNESS + SKILL-MAP)
D   Union verdicts — BLOCK if any Critical/High
E   Resume worker ≤3 rounds → re-review
F   PASS → REVIEW-ARTIFACT → orch Step 4 merge + cleanup
```

## Phase A–B — Execute

[/andx-execute](../andx-execute/SKILL.md) § Orchestrator preflight + spawn. Worker Phases 0–4 → handoff. **Do not merge.** Worker fail → stop (no review).

## Phase C — Review (parallel, blind)

Fresh agents only; read-only; adversarial. Give: `git diff TARGET_BRANCH..EXEC_BRANCH`, plan (`touch`/`success`/`verification`/`design_refs`), verification evidence.

**Always:** Reviewers 1–3 (bugbot, security, ponytail-review) per SKILL-MAP + HARNESS.
**Conditional:** 4–7 per SKILL-MAP triggers.
**Karpathy on bugbot results:** surgical scope HIGH; speculative abstraction MEDIUM.

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

Orchestration Step 4: merge → post-merge Phase 3 → cleanup evidence.

## Definition of done

Worker pass; always Reviewers 1–3 PASS; conditionals 4–7 PASS when their gates ran; no open High; merged + post-merge green + cleanup.

## Anti-patterns

- Reviewer shares worker context
- Merge with open High
- Parent “just fixes” source
- Whole-repo ponytail-audit (scope to `touch`)
- Treating `shrink:` as blocker
