# andx worker (Phases 0–4)

You implement inside `WORKTREE_DIR` on `EXEC_BRANCH`; the parent owns merge, push, and cleanup.

## Workspace

- Every Read/Write/StrReplace/Shell uses absolute `$WORKTREE_DIR/...` paths or Shell `working_directory=$WORKTREE_DIR`. A relative path resolves to the primary TARGET checkout.
- Stay in the parent's workspace (no `move_agent_to_root` / `move_agent_to_cloned_root`).
- Commit on `EXEC_BRANCH` only. Push only when the prompt says so. Leave the worktree and branch in place for the parent.

## Phase 0 — Verification table

Before code: dependency-ordered steps with kind / success / verification. UI → add UX criterion. `design_refs` → success traces to contract. Debug origin → pre-fill from analyst handoff.

## Phase 1 — Execute

**`kind: docs` / `DOCS_ONLY`:** edit docs per `doc-sync-map` → run verification → done. No TDD.

**Else:** Red → Green per `/tdd`, testing only at the step's `seams` (already agreed at plan time; missing `seams` → test at the public interface named in `success` and note it in the handoff). Expected values come from an independent source (literal, worked example, spec), never recomputed the way the code does (tautological test = fail). UI/mixed: `/impeccable` before Red when applicable. `REACT_STACK` + React paths: follow `~/.cursor/skills/react-best-practices/SKILL.md`. Quote gate output. Out of plan → ask or `OUT OF SCOPE`.

**Screenshots:** DOM/a11y assertions first; image only when layout itself is the claim. Downscale before Read: `sips -Z 1000 in.png --out /tmp/<name>.png` (Linux: `magick in.png -resize 1000x1000\> /tmp/<name>.png`). Max 3 images per round.

**Workspace rules:** obey the scoped rules the parent passed in for Phases 1–3.

## Phase 2 — Fail loop

Diagnose → fix criterion → implement → re-run (max 3 attempts) → stop with blocker.

## Phase 3 — Final on EXEC_BRANCH

Full regression + lint (even docs) + doc verifier if needed + every table row. Fresh evidence.

**Comment hygiene gate:** [CODE-COMMENTS.md](./CODE-COMMENTS.md) — read it only when this fails:

```bash
git diff "$TARGET_BRANCH"...HEAD | rg -n '^\+.*(ponytail:|shrink:|andx:|caveman|/andx-|andx/exec-)' && exit 1 || true
```

Rewrite hits to plain English / public branch pins before Phase 4.

## Phase 4 — Commit and hand off

Stage plan scope; conventional commits; clean `git status`. Commit messages pass the [MR and commit text gate](./CODE-COMMENTS.md#mr-and-commit-text-gate). Return exactly:

```markdown
## Handoff

- **Status:** pass | fail
- **EXEC_BRANCH:** andx/exec-…
- **WORKTREE_DIR:** …
- **worktree_preserved:** true
- **Pre-handoff git status:** clean | dirty (must be clean on pass)
- **Commits:** `git log TARGET_BRANCH..EXEC_BRANCH --oneline`
- **Verification table:** (each row: command, outcome, snippet)
- **Phase 3 regression:** command + outcome on EXEC_BRANCH
- **Blockers:** (if fail) symptom, attempts, next experiment
```

Every snippet comes from this run.
