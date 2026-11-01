---
name: andx-mr-review
description: "/andx-mr-review: review a GitLab/GitHub/Bitbucket MR from a URL, draft human comments plus a chat report, post only after approval. Use for \"review this MR\" or /andx-pr-review."
---
# Andx MR Review

Remote MR review with **dual output**: teaching-depth chat report + human MR comments.

Each companion doc is linked from the step that needs it; read it there, not up front.

## When to use

- **Others’ MRs first-class** — review teammate's MR and leave styled comments
- Own MR after push
- `/andx-mr-review <MR-URL>`
- After `/andx-execute-and-review` — format/post from `REVIEW-ARTIFACT` (no double discovery)

**Not for:** implementing fixes, merging, or local branch gates (use `/andx-execute-and-review`). For **merge-ready** (resolve conflicts, triage comments, fix CI) use `/andx-mr-babysit`.

## Flags

| Flag | Effect |
|------|--------|
| (default) | Bugbot + `andx-security-reviewer` (+ refuters) + ponytail-review subagents |
| `--fast` | Bugbot only |
| `--deep` | Default + Cursor `security-review` + react-best-practices + accessibility when UI/React in diff |
| `--append-snippet <note_id>` | Append fix block to existing note; preserve original text |

## Required companion skills

| Skill | Role |
|-------|------|
| [review-bugbot](~/.cursor/skills-cursor/review-bugbot/SKILL.md) | Bugbot subagent |
| [andx-security-review](../andx-security-review/SKILL.md) | Security reviewer (gate mode via `andx-security-reviewer`) |
| [review-security](~/.cursor/skills-cursor/review-security/SKILL.md) | Cursor security-review, `--deep` only |
| [ponytail-review](../andx-orchestration/HARNESS.md#ponytail-resolve) | Over-engineering (default always; resolve path via HARNESS) |
| [react-best-practices](~/.claude/skills/react-best-practices/SKILL.md) | `--deep` when React in diff |
| [accessibility](~/.cursor/skills/accessibility/SKILL.md) | `--deep` when UI in diff |
| [HOSTS.md](./HOSTS.md) | glab / gh / bitbucket commands |

---

## Workflow

### 1. Parse URL

Extract host (gitlab | github | bitbucket), `owner/repo`, MR iid. See [HOSTS.md](./HOSTS.md).

### 2. Preflight

- `glab auth status` / `gh auth status` — fail fast with setup hints
- Fetch MR metadata, diff stats, pipeline status
- `glab mr note list` / `gh pr view --comments` — load existing threads (dedup)
- GitLab: confirm `ssh_host` if remote uses SSH alias

### 3. Artifact check

```bash
git fetch origin <source-branch>
git show origin/<source-branch>:.cursor/reviews/*.json
```

For each artifact run `node ~/.cursor/skills/andx-mr-review/scripts/validate-review-artifact.mjs <file> --head <head_sha> --base <base_sha>`. If one prints `TRUSTED`:

- **Skip step 5** (subagents)
- Load findings into report + MR drafts
- Log: `Subagents skipped: artifact match`

### 4. Materialize diff

Follow [review-bugbot](~/.cursor/skills-cursor/review-bugbot/SKILL.md) checkout rules:

- Fetch MR head branch
- Checkout if needed; stash only after user confirms on conflict
- Record `base_sha`, `head_sha` for inline comment positions

### 5. Workspace review gates (any repo — before subagents)

Load per [workspace rules](../andx-orchestration/WORKSPACE-RULES.md) using the MR changed paths; fold gate titles into Bugbot `Custom Instructions` and the security reviewer prompt.

### 6. Run reviewers (parallel)

Unless artifact mode or `--fast`:

| Agent | subagent_type | When |
|-------|---------------|------|
| Bugbot | `bugbot` | always (incl. `--fast`) |
| Security | `andx-security-reviewer`, then parent-spawned `andx-refuter` per proposed critical/high | default full (not `--fast`) |
| Ponytail | readonly explore or ponytail-review skill | default full |

`--deep`: add react-best-practices + accessibility passes on UI diff paths.

Package the MR diff (step 4 refs, never the default branch). One reports dir per MR head, so reports for an earlier head are never read:

```bash
ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"; RUN_DIR="$ROOT/.worktrees/.andx-run/review-mr-<iid>-<head_sha>"
mkdir -p "$RUN_DIR"; git -C "$ROOT" check-ignore -q .worktrees/ || echo .worktrees/ >> "$(git rev-parse --git-path info/exclude)"
node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs package --base <base_sha> --head <head_sha> --out "$RUN_DIR/package.diff"
```

Prompt shape per review-bugbot / review-security skills, plus (Bugbot: in `Custom Instructions`, with "review only `git diff <base_sha>..<head_sha>`"):

```
Package: <RUN_DIR>/package.diff. Review only that diff. MR context: <title, description>.
Focus: UX/API for forms + API clients. Workspace gates: <titles from step 5 or none>.
Report: write it to <RUN_DIR>/andx-review-mr-<iid>-<reviewer>.txt, reply "<path> <status>"; cannot write → reply with it.
Rules: each High/Critical quotes its diff line (`code` or "> line"), else it counts as Medium.
End the report with a ## VERDICT block, one "- [SEV] <file:line> — <one line>" per finding.
```

Spawn all reviewers in one message, foreground. `<reviewer>`: `bugbot`, `security`, `ponytail`, `react`, `a11y`. Save inline replies to that path verbatim. Save the refuters' JSON decisions as one array to `$RUN_DIR/refuters.json` (`[]` when none). Cursor `security-review` (`--deep`) is not a union reviewer; fold its findings in by hand in step 7.

### 7. Synthesize

```bash
node ~/.cursor/skills/andx-execute-and-review/scripts/review.mjs union --base <base_sha> --head <head_sha> \
  --reports "$RUN_DIR" --slug mr-<iid> --expect <reviewers spawned> --refuters "$RUN_DIR/refuters.json" > "$RUN_DIR/verdict.json"
```

Union rules: `review.mjs --help`. Work from `verdict.json` only. A reviewer in `unparsed`: Bugbot → read its report and classify by hand (never re-request); others → re-request once, then report it as unreviewed.

- Sort `blockers` + `advisory` + `deferred`: high → medium → low → nitpick
- Enrich each with `ux_flow` / `api_note` (read i18n, apiSlice, types)
- **Workspace gates:** each violated gate from step 5 → finding at the gate file severity.
- **Harness jargon:** `node ~/.cursor/skills/andx-execute/scripts/jargon-gate.mjs diff <base_sha> <head_sha>`; each hit → medium.
- Apply comment budget: inline = high/medium; nitpicks → separate bucket
- Cap ~8 inline; overflow → summary table only

### 8. Draft outputs

**Chat report** — full [REPORT-FORMAT.md](./REPORT-FORMAT.md) with line links and fix snippets.

**MR comment drafts** — [COMMENT-STYLE.md](./COMMENT-STYLE.md) + [EXAMPLES.md](./EXAMPLES.md).

Present:

1. Summary table
2. Full chat report
3. Per-comment previews with host line anchors

Optional export: `<workspace>/.cursor/reviews/<mr-id>-report.md`

### 9. Approval gate (default — draft in chat first)

1. *"Post M inline comments + summary note?"* — wait for yes
2. If nitpicks drafted: *"Post N nitpicks?"* — default no

Never edit user's existing MR comment body — append-only via `--append-snippet`.

### 10. Post

Per [HOSTS.md](./HOSTS.md):

- Summary: `--resolvable=false`
- Inline: `--file --line`
- Nitpick: `**nitpick:**` prefix
- Related follow-up: `--reply`

Use `--unique` on re-runs to avoid duplicate bodies.

---

## Anti-patterns

- Posting without approval
- Re-running subagents when fresh artifact exists
- Long essays in MR comments (use chat report)
- Editing author comments in place
- Secrets in fix snippets
