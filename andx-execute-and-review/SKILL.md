---
name: andx-execute-and-review
description: "/andx-execute-and-review: andx-execute plus blind reviewers (Bugbot, security, ponytail) gating the merge; --mr pushes a draft MR and babysits it. Use for \"execute and review\"."
effort: medium
---
# Andx Execute and Review

**Blind reviewers** gate the worker's merge to `TARGET_BRANCH`.

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Spawn: [HARNESS.md](../andx-orchestration/HARNESS.md)

**Required:** [/andx-orchestration](../andx-orchestration/SKILL.md), [/andx-execute](../andx-execute/SKILL.md). Reviewer roster + severity → SKILL-MAP. Review module (package, union, artifact; union rules in its help): `node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs --help`.

## When

Second pass before land; no gate → `/andx-execute`. `--deploy` (= `/andx-execute-review-and-deploy`): push + deploy after the DoD. `--mr`: draft MR, no merge.

## Workflow

```
A–B Worker Phases 0–4 on EXEC_BRANCH (no merge)
C   review.mjs package → parallel fresh reviewers → one report file each
D   review.mjs union → verdict.json; BLOCK on any Critical/High or unparsed report
E   Resume worker ≤3 rounds → re-review the fix delta
F   PASS → review.mjs artifact → orch Step 4 (ship-queue land) + cleanup
```

## Phase A–B — Execute

[/andx-execute](../andx-execute/SKILL.md) Preflight + Phase A, but `node "$S/run.mjs" start --slug "$SLUG" --mode review` (`--mr`: `review-mr`; `--deploy`: `review-deploy`). **Do not merge.** Worker fail → stop (no review).

## Phase C — Review (parallel, blind)

`ROUND` starts at 1. `BASE` = `MERGE_BASE_SHA` in round 1, else the previous `EXEC_HEAD`.

```bash
RUN_DIR="$REPO_ROOT/.worktrees/.andx-run/review-$SLUG/r$ROUND"; mkdir -p "$RUN_DIR"
node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs package --repo "$WORKTREE_DIR" --base "$BASE" --head "$EXEC_HEAD" --out "$RUN_DIR/package.diff"
```

Exit 3 (empty or unrelated range) → stop, report.

**Always:** Bugbot, Security (`andx-security-reviewer`), Ponytail (ponytail-review), Spec (`andx-spec-reviewer`) per SKILL-MAP + HARNESS. `DOCS_ONLY`: Bugbot + Spec only. **Conditional:** Audit, React, A11y, UX/API per SKILL-MAP triggers. Load [workspace rules](../andx-orchestration/WORKSPACE-RULES.md) first; violated gates go into the prompt as blockers.

Fresh agents only; read-only; foreground (`run_in_background: false`, all in one message). Each gets this prompt; Bugbot in `Custom Instructions`, plus "review only `git diff $BASE..$EXEC_HEAD`" so it keeps its native diff:

```
Package: <RUN_DIR>/package.diff (commits, stat, diff). Review only that diff.
Plan: <plan path>. Evidence: <worker verification table>. Workspace gates: <titles or none>.
Report: write it to <RUN_DIR>/andx-review-<SLUG>-<reviewer>.txt, reply "<path> <status>"; cannot write → reply with it.
Rules: each High/Critical quotes its diff line (`code` or "> line"), else it counts as Medium.
Round 2+: confirm or clear prior blockers <list>; a new finding must sit on a line this round added.
End with ## VERDICT: status BLOCK|PASS; blockers, advisory as "- [SEV] <file:line> — <one line>".
```

`<reviewer>`: `bugbot security ponytail spec audit react a11y ux-api`. Parent saves inline reports to that path verbatim.

**Security refutation:** one `andx-refuter` per security candidate with `status: proposed` (critical/high), foreground, one message. Save their JSON decisions as one array to `$RUN_DIR/refuters.json` (`[]` when none).
**Harness jargon (parent):** `node ~/.cursor/skills/andx-execute/scripts/jargon-gate.mjs diff "$MERGE_BASE_SHA" "$EXEC_HEAD" --repo "$WORKTREE_DIR"`; each hit is a MEDIUM (skill repos add `--allow-skill-text`).

## Phase D — Union

```bash
node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs union --repo "$WORKTREE_DIR" --base "$BASE" --head "$EXEC_HEAD" --reports "$RUN_DIR" --slug "$SLUG" \
  --expect bugbot,security,ponytail,spec --refuters "$RUN_DIR/refuters.json" > "$RUN_DIR/verdict.json"
# round 2+: --expect <reviewers spawned this round> --round "$ROUND" --prior <previous RUN_DIR>/verdict.json
```

Route from `verdict.json` only, never raw reports. Final `PASS` (after any fix loop) → ledger phases `C`, `D` (`--deploy`: skip; andx-deploy records them). A reviewer in `unparsed`: Bugbot → read its report and classify by hand (never re-request); others → re-request the VERDICT once and re-run union; still unparsed → BLOCK. `dropped` is not routed.

## Phase E — Fix loop

**MEDIUM:** fix in the same round when it is in plan scope and reproducible from the diff. Defer only speculative, style-only, or out-of-scope items, each with a one-line reason. The final reply lists every deferred item and asks "fix now?", plus each `rejected` critical/high with the refuter's reason.

Resume worker (`resume=<id>`) with `blockers` + in-scope `advisory` + jargon hits; Phase 3 on EXEC_BRANCH; next round re-reviews only the fix delta with Bugbot plus the reviewers whose blockers or MEDIUMs this round fixed. Add Spec only when the delta touches paths outside the plan `touch`. A reviewer whose findings were all PASS/advisory is not re-spawned.

**Round cap:** after round 3 still BLOCK → AskQuestion with exactly: "one more round" / "merge, deferring only MEDIUM/LOW" / "abort". Critical/High are never deferred. `run.mjs end --terminal AWAITING_USER` while waiting.

## Phase F — Merge

On PASS, before merge:

```bash
node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs artifact --verdict "$RUN_DIR/verdict.json" --plan ".cursor/plans/$SLUG.plan.md" \
  --target "$TARGET_BRANCH" --out "$WORKTREE_DIR/.cursor/reviews/$SLUG.json"
```

INVALID → fix the inputs and re-run, never hand-edit. The parent commits only that file on `EXEC_BRANCH`: `chore(review): add REVIEW-ARTIFACT for <plan-slug>`. Then andx-execute Phase F: orch Step 4 (ship-queue land), ledger `F`, its `--deploy` path.

## MR mode (`--mr`)

Replaces Phase F's merge with a draft MR. Never merges to the default branch.

1. **Scope contract** from plan frontmatter: `mr_branch` (reviewer-facing name, no `andx/exec-*`), optional `mr_iids`, `base_sha`. Pushing to a branch not in `mr_branch`/`mr_iids` needs user confirmation.
2. **Push:** `git -C "$WORKTREE_DIR" push origin "$EXEC_BRANCH:$mr_branch"` (no force unless the user asked). Verify `git ls-remote origin "$mr_branch"` equals `EXEC_HEAD`.
3. **Draft MR:** create or update as **draft** via [HOSTS.md](../andx-mr-review/HOSTS.md); title + body must pass `node ~/.cursor/skills/andx-execute/scripts/jargon-gate.mjs text -` (stdin). Ledger phase `MR`; URL → `run.mjs end --mr`.
4. **Cleanup:** orch Step 4 push-to-MR runs.
5. **Babysit:** Read `../andx-mr-babysit/SKILL.md` and follow it on the MR URL. Babysit owns the loop and its escalation bound; this skill owns only push + draft. Babysit findings about code outside `base_sha..head` are rejected.

**Done (MR mode):** MR still draft, remote head = last pushed SHA, CI green or escalated, thread guard PASS, status line `MERGED - | PUSHED <s> | MR <url> | DEPLOYED NOT_REQUESTED`.

## Definition of done

Worker pass; always-on reviewers PASS; conditionals PASS when their gates ran; no open High; merged + post-merge green + cleanup + queue release (`--deploy`: by andx-deploy after health); `run.mjs end --terminal DONE`; reply ends with its status line.

## Anti-patterns

- Reviewer shares worker context
- Merge with open High
- Parent “just fixes” source
- Whole-repo ponytail-audit (scope to `touch`)
- Treating `shrink:` as blocker
