---
name: andx-execute-and-review
description: "/andx-execute-and-review: andx-execute plus blind reviewers (Bugbot, security, ponytail) gating the merge; --mr pushes a draft MR and babysits it. Use for \"execute and review\"."
effort: medium
---
# Andx Execute and Review

Worker implements in worktree; **blind reviewers** gate merge to `TARGET_BRANCH`.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), [/andx-execute](../andx-execute/SKILL.md). Reviewer roster + severity → SKILL-MAP. Artifact → [FINDINGS-SCHEMA.md](../andx-mr-review/FINDINGS-SCHEMA.md).

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

Fresh agents only; read-only; adversarial; foreground (`run_in_background: false`, all reviewers in one message). Give: `MERGE_BASE_SHA` + `EXEC_HEAD` (orch Variables) with "review only `git diff MERGE_BASE_SHA..EXEC_HEAD`" (Bugbot: in `Custom Instructions`), plan (`touch`/`success`/`verification`/`design_refs`), verification evidence.

**Always:** Bugbot, Security (`andx-security-reviewer`), Ponytail (ponytail-review), Spec (`andx-spec-reviewer`) per SKILL-MAP + HARNESS. Docs-only plans (`DOCS_ONLY`): Bugbot + Spec only.
**Unique catches:** every artifact finding lists all `reviewers` that raised it (same location ± 3 lines, same root cause), so `/retro` can count catches no other reviewer made.
**Security refutation:** after reviewers return, spawn one `andx-refuter` per security candidate with `status: proposed` (critical/high), foreground, one message ([VERIFIER.md](../andx-security-review/VERIFIER.md)). Only `confirmed` critical/high blocks; `needs_validation` goes to advisory with its blocker; `rejected` fingerprints are recorded and not re-raised in later rounds, and the final reply lists each rejected critical/high with the refuter's reason (unmeasured refuter: [MEASUREMENT.md](../andx-security-review/MEASUREMENT.md)).
**Conditional:** Audit, React, A11y, UX/API per SKILL-MAP triggers.
**Harness jargon (parent, no reviewer needed):** `git diff "$MERGE_BASE_SHA".."$EXEC_HEAD" | rg -n '^\+.*(ponytail:|shrink:|andx:|caveman|/andx-|andx/exec-)'`; each hit is a MEDIUM per [CODE-COMMENTS.md](../andx-execute/CODE-COMMENTS.md).

**Workspace rules:** load per [workspace rules](../andx-orchestration/WORKSPACE-RULES.md) before spawning reviewers; violated gates are VERDICT blockers.

### Verdict contract

```
## VERDICT
status: BLOCK | PASS
blockers:
  - [CRITICAL|HIGH] <file:line> — <one line>
advisory:
  - [MEDIUM|LOW] <file:line> — <one line>
```

### Normalize, then union

Save each reviewer's raw output to `/tmp/andx-review-<slug>-<reviewer>.txt` and run:

```bash
node ~/.cursor/skills/andx-execute-and-review/scripts/parse-review.mjs <reviewer> /tmp/andx-review-<slug>-<reviewer>.txt
```

It reads, in order: Bugbot native `<answer><bug>…</bug></answer>` (empty = PASS), a single real VERDICT (echoed `BLOCK | PASS` templates ignored), a severity table, "no bugs" prose. Output `{status: BLOCK|FIX|PASS|UNPARSED, findings[]}`. Union the normalized findings across reviewers; compute BLOCK from the union.

- **Bugbot:** never re-request (it cannot resume and repeats itself). `UNPARSED` → parent reads the text and classifies by hand.
- **generalPurpose reviewers:** `UNPARSED` → re-request the VERDICT once; still unparsed → BLOCK.
- **Each HIGH/CRITICAL:** parent runs one `git show`/`rg` check against `EXEC_HEAD` before routing it to the worker; a finding about code outside `MERGE_BASE_SHA..EXEC_HEAD` is dropped as wrong-base.

### REVIEW-ARTIFACT (on PASS, before merge)

Parent may write/commit **only** `.cursor/reviews/<plan-slug>.json` on `EXEC_BRANCH` (or resume worker to do it) — not app source. Schema: FINDINGS-SCHEMA **v2** (`base_sha` = `MERGE_BASE_SHA`, finding `status`/`resolution`); run `node ~/.cursor/skills/andx-mr-review/scripts/validate-review-artifact.mjs <file>` before commit (must not print INVALID). Commit `chore(review): add REVIEW-ARTIFACT for <plan-slug>`; then Phase F.

## Phase D–E — Verdict + fix loop

**BLOCK** = any Critical/High from **any** reviewer. UX/API is advisory unless paired with another High. Low → advisory.

**MEDIUM:** fix in the same round when it is in plan scope and reproducible from the diff. Defer only speculative, style-only, or out-of-scope items, each with a one-line reason. The final reply lists every deferred item and asks "fix now?".

Resume worker (`resume=<id>`) with union blockers + in-scope MEDIUMs; Phase 3 on EXEC_BRANCH; re-review only the fix delta (`git diff <previous EXEC_HEAD>..<new EXEC_HEAD>`) with Bugbot plus the reviewers whose blockers or MEDIUMs this round fixed. Add Spec only when the delta touches paths outside the plan `touch`. A reviewer whose findings were all PASS/advisory is not re-spawned.

**Round cap:** after round 3 still BLOCK → AskQuestion with exactly: "one more round" / "merge, deferring only MEDIUM/LOW" / "abort". Critical/High are never deferred. Set ledger `terminal: AWAITING_USER` while waiting.

## Phase F — Merge

Orchestration Step 4 (ship queue, concurrent-merge with its conflict-delta Bugbot rule), post-merge Phase 3, cleanup evidence.

## MR mode (`--mr`)

Replaces Phase F when the user wants a draft MR instead of a local merge (ledger `mode: review-mr`). Never merges to the default branch.

1. **Scope contract** from plan frontmatter: `mr_branch` (reviewer-facing name, no `andx/exec-*`), optional `mr_iids`, `base_sha`. Pushing to a branch not in `mr_branch`/`mr_iids` needs user confirmation.
2. **Push:** `git -C "$WORKTREE_DIR" push origin "$EXEC_BRANCH:$mr_branch"` (no force unless the user asked). Verify `git ls-remote origin "$mr_branch"` equals `EXEC_HEAD`.
3. **Draft MR:** create or update as **draft** via [HOSTS.md](../andx-mr-review/HOSTS.md); title/body pass the [MR and commit text gate](../andx-execute/CODE-COMMENTS.md#mr-and-commit-text-gate). Record the URL in the ledger.
4. **Cleanup:** orch Step 4 push-to-MR runs.
5. **Babysit:** Read `../andx-mr-babysit/SKILL.md` and follow it on the MR URL. Babysit owns the loop and its escalation bound; this skill owns only push + draft. Babysit findings about code outside `base_sha..head` are rejected.

**Done (MR mode):** MR still draft, remote head = last pushed SHA, CI green or escalated, thread guard PASS, status line `MERGED - | PUSHED <s> | MR <url> | DEPLOYED NOT_REQUESTED`.

## Definition of done

Worker pass; always-on reviewers PASS; conditionals PASS when their gates ran; no open High; merged + post-merge green + cleanup + queue release (deploy composers: andx-deploy releases after health); ledger `terminal: DONE`; reply ends with the orch status line.

## Anti-patterns

- Reviewer shares worker context
- Merge with open High
- Parent “just fixes” source
- Whole-repo ponytail-audit (scope to `touch`)
- Treating `shrink:` as blocker
