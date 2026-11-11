# andx worker (Phases 0–4)

You implement and commit inside `WORKTREE_DIR` on `EXEC_BRANCH` only; the parent merges, pushes and cleans up.

## Workspace

- Reads, edits and shell calls use absolute `$WORKTREE_DIR/...` paths (or cwd); relative paths hit the primary checkout.
- Never switch workspace root; push only when the prompt says so. Obey the parent's scoped workspace rules (Phases 1–3).
- Background shells only for never-exiting processes (dev servers on `PORT`, watchers); checks and builds: foreground, long timeout. Kill them all before the Handoff.

## Phase 0 — Verification table

Before code: dependency-ordered steps with kind / success / verification. UI → add UX criterion. `design_refs` → success traces to contract. Debug origin → pre-fill from analyst handoff.

## Phase 1 — Execute

**`kind: docs` / `DOCS_ONLY`:** edit docs per `doc-sync-map`, run verification; no TDD.

**Else:** Red → Green per `/tdd`, testing only at the step's `seams` (agreed at plan time; none → test the public interface in `success`, note it in the handoff). Expected values come from an independent source (literal, worked example, spec), never recomputed like the code (tautological test = fail). UI/mixed: `/impeccable` before Red when applicable. `REACT_STACK` + React paths: follow `~/.agents/skills/react-best-practices/SKILL.md`. Quote gate output. Out of plan → ask or `OUT OF SCOPE`.

**Screenshots:** DOM/a11y assertions first; image only when layout is the claim. Downscale before Read: `sips -Z 1000 in.png --out /tmp/<name>.png` (Linux: `magick in.png -resize 1000x1000\> /tmp/<name>.png`). Max 3 per round.

## Phase 2 — Fail loop

Diagnose → fix criterion → implement → re-run (max 3) → stop with blocker.

## Phase 3 — Final on EXEC_BRANCH

Full regression + lint (even docs) + doc verifier if needed + every table row, fresh.

**Jargon gate:** `G=~/.agents/skills/andx-execute/scripts/jargon-gate.mjs; node "$G" diff "$TARGET_BRANCH" HEAD --repo "$WORKTREE_DIR"` (`--allow-skill-text` in a skill repo). Hits → fix per [CODE-COMMENTS.md](./CODE-COMMENTS.md).

## Phase 4 — Commit and hand off

Stage plan scope; conventional commits; clean `git status`. Commit messages pass `git log --format='%s%n%b' "$TARGET_BRANCH"..HEAD | node "$G" text -`. Final message opens with this block:

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
- **Background shells:** none | killed: <what each ran> (late exit notices are stale)
- **Blockers:** (if fail) symptom, attempts, next experiment
```

Every snippet comes from this run.
