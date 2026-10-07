---
name: andx-mr-review
description: >-
  Review a remote GitLab/GitHub/Bitbucket MR from a URL — run layered review
  (Bugbot, Security, ponytail; tiered --fast/--deep), draft human MR comments in
  COMMENT-STYLE voice with fix snippets and line links, print a detailed chat report
  (UI/UX flows, API contract). Posts only after explicit approval. Skips subagents
  when REVIEW-ARTIFACT.json on MR head matches head_sha (from /andx-execute-and-review).
  Use for /andx-mr-review, /andx-pr-review (alias), "review this MR", or MR links with code review + comments.
---

# Andx MR Review

Remote MR review with **dual output**: teaching-depth chat report + human MR comments.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

Companion docs: [COMMENT-STYLE.md](./COMMENT-STYLE.md) · [REPORT-FORMAT.md](./REPORT-FORMAT.md) · [HOSTS.md](./HOSTS.md) · [FINDINGS-SCHEMA.md](./FINDINGS-SCHEMA.md) · [EXAMPLES.md](./EXAMPLES.md)

## When to use

- **Others’ MRs first-class** — review teammate's MR and leave styled comments
- Own MR after push
- `/andx-mr-review <MR-URL>`
- After `/andx-execute-and-review` — format/post from `REVIEW-ARTIFACT` (no double discovery)

**Not for:** implementing fixes, merging, or local branch gates (use `/andx-execute-and-review`). For **merge-ready** (resolve conflicts, triage comments, fix CI) use `/andx-mr-babysit`.

## Relationship to `/andx-execute-and-review`

| Skill | Role |
|-------|------|
| `andx-execute-and-review` | **Discover** findings + VERDICT gate + write `.cursor/reviews/<plan-slug>.json` |
| `andx-mr-review` | **Publish** human comments on host MR; expand UX/API in chat report |

Auto-detect artifact: if `head_sha` matches MR head → skip subagents (see [FINDINGS-SCHEMA.md](./FINDINGS-SCHEMA.md)).

## Flags

| Flag | Effect |
|------|--------|
| (default) | Bugbot + security-review + ponytail-review subagents |
| `--fast` | Bugbot only |
| `--deep` | Default + react-best-practices + accessibility when UI/React in diff |
| `--from-artifact` | Force artifact mode (error if missing/stale) |
| `--force-full` | Always run subagents |
| `--post` | Post after draft without second confirm (use sparingly) |
| `--all-nitpicks` | Include nitpicks in first post prompt (default: separate nitpick gate) |
| `--append-snippet <note_id>` | Append fix block to existing note; preserve original text |

## Required companion skills

| Skill | Role |
|-------|------|
| [review-bugbot](~/.cursor/skills-cursor/review-bugbot/SKILL.md) | Bugbot subagent |
| [review-security](~/.cursor/skills-cursor/review-security/SKILL.md) | security-review subagent |
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

If any artifact has `head_sha` === MR head SHA and not `--force-full`:

- **Skip step 5** (subagents)
- Load findings into report + MR drafts
- Log: `Subagents skipped: artifact match`

### 4. Materialize diff

Follow [review-bugbot](~/.cursor/skills-cursor/review-bugbot/SKILL.md) checkout rules:

- Fetch MR head branch
- Checkout if needed; stash only after user confirms on conflict
- Record `base_sha`, `head_sha` for inline comment positions

### 5. Workspace review gates (any repo — before subagents)

Product-specific review checklists live in the **target workspace**, not this skill.

1. Resolve workspace root (MR checkout, or parent multi-repo map that contains it).
2. If `agents/rules/README.md` exists, read it. Load every rule listed under
   **review** / **Review** whose scope matches the MR’s repo or changed paths
   (also accept files named `*-review-gates.md` / `*review*gates*.md` under
   `agents/rules/`).
3. If no `agents/rules/` but the repo has `.cursor/rules/*review*` stubs that
   point at a canonical markdown body — follow that body.
4. Fold the loaded checklist into Bugbot / security-review **`Custom Instructions`**
   (quote the gate titles; do not paste entire novels).
5. If no workspace review gates → skip; do **not** invent product rules here.

This skill stays host- and product-agnostic; gates travel with each workspace.

### 6. Run reviewers (parallel)

Unless artifact mode or `--fast`:

| Agent | subagent_type | When |
|-------|---------------|------|
| Bugbot | `bugbot` | always (incl. `--fast`) |
| Security | `security-review` | default full (not `--fast`) |
| Ponytail | readonly explore or ponytail-review skill | default full |

`--deep`: add react-best-practices + accessibility passes on UI diff paths.

Prompt shape per review-bugbot / review-security skills. `Custom Instructions`:
MR context + "review only `git diff <base_sha>..<head_sha>`" (MR diff refs from
step 4, never the default branch) + focus UX/API for forms + API clients +
**workspace review gates** from step 5 (if any). Spawn all reviewers in one
message, foreground.

Normalize each output with
[parse_review.rb](../andx-execute-and-review/scripts/parse_review.rb)
(Bugbot native XML first; never re-request Bugbot), then synthesize.

### 7. Synthesize

- Dedup overlapping findings (same `location` or same root cause)
- Sort: high → medium → low → nitpick
- Enrich each with `ux_flow` / `api_note` (read i18n, apiSlice, types)
- **Workspace gates pass:** any unchecked / violated gate from step 5 → finding
  at the severity that gate file defines (default medium; silent wrong-curve /
  wrong-pubkey / SUCCESS-on-bad-sig → high when the gate says so).
- **Harness-jargon pass (always):** scan `base...HEAD` added lines for
  `ponytail:`, `shrink:`, `andx:`, `caveman`, skill/plugin names, `andx/exec-*`
  pins in source **or** shipped runbooks/checklists. Each hit → **medium**
  finding citing [CODE-COMMENTS.md](../andx-execute/CODE-COMMENTS.md) — first-time
  reviewer must understand the line without agent chat.
- Apply comment budget: inline = high/medium; nitpicks → separate bucket unless `--all-nitpicks`
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

Unless `--post`:

1. *"Post M inline comments + summary note?"* — wait for yes
2. If nitpicks drafted and not `--all-nitpicks`: *"Post N nitpicks?"* — default no

Never edit user's existing MR comment body — append-only via `--append-snippet`.

### 10. Post

Per [HOSTS.md](./HOSTS.md):

- Summary: `--resolvable=false`
- Inline: `--file --line`
- Nitpick: `**nitpick:**` prefix
- Related follow-up: `--reply`

Use `--unique` on re-runs to avoid duplicate bodies.

---

## Roadmap

- Style profiles per author (learn from past `glab mr note list`)
- GitLab MCP when plugin healthy
- Bitbucket API post support
- `knowledge/reviews/patterns.md` via `/andx-init`
- Locale toggle for report vs MR comments

## Anti-patterns

- Posting without approval (unless `--post`)
- Re-running subagents when fresh artifact exists
- Long essays in MR comments (use chat report)
- Editing author comments in place
- Secrets in fix snippets

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Author built via plan | `/andx-execute-and-review` first → artifact → `/andx-mr-review` |
| Local merge gate only | `/andx-execute-and-review` |
| Security-only pass | `--fast` + manual security or `/review-security` |
| Drive MR to merge-ready | `/andx-mr-babysit` after review (or alone when only fixes needed) |
