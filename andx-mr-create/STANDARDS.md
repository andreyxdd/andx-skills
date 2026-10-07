# Andx MR create — standards

Codified from Solana MR unite / babysit thread (2026-08). Apply on every `/andx-mr-create`.

## Branch name

Format: `{username}/VLT-{n}-{mr-slug}` when a ClickUp task exists; else `{username}/{mr-slug}`.

- **username = your account handle on the `origin` host** (differs per host, e.g. GitLab `andrei.volkov`, GitHub `andreyxdd`). Derive, in order:
  1. Host API for `origin`: GitLab `glab api user --hostname <origin-host> | jq -r .username`; GitHub `gh api user --jq .login`
  2. Repo-local override only: `git config --local --get andx.mr-username` (never a global value — it would leak one host's handle to another)
  3. Ask once; offer `git config --local andx.mr-username <handle>`
- Never derive from `$USER`, the OS login, `user.name`, or existing branch prefixes.
- **VLT-{n}:** ClickUp custom id for this MR’s task (required when the work has a VLT ticket). Matches team convention (`feat(VLT-2417): …`, branch `VLT-2968-…`).
- **mr-slug:** short kebab-case, descriptive of *product* change (not process).  
  Good: `ed25519-native-sign`, `solana-dual-masters`, `solana-dual-master-ux`  
  Bad: `solana-united`, `andx/exec-…`, `fix-lint`, `wip`
- One feature branch per MR. Stacked MRs OK when user asks (later MR targets earlier branch).

## Title and commits

- **MR title:** `feat(VLT-{n}): <short summary>` (or `fix`/`chore`/`ci`). Never omit VLT when a task exists.
- **Commits on the branch:** same — `feat(VLT-{n}): …` / `fix(VLT-{n}): …`.

## Description shape

1. **Summary** — what / why for a reviewer who never saw the implementation chat. Bullets OK. No process history.
2. **Related** (optional) — links to **other services’ MRs** that give context. Full URLs.
3. **Suggested review order** — numbered; each entry links to **files in this MR** via host blob URLs on the **source branch**:
   - GitLab: `https://<host>/<group>/<repo>/-/blob/<urlencoded-branch>/<urlencoded-path>`
   - GitHub: `https://github.com/<owner>/<repo>/blob/<branch>/<path>`
   - Only files that appear in `base...HEAD` diff.
4. **Test plan** — checkboxes for what a human can verify from this MR.

Title: conventional (`feat(scope): …` / `fix(scope): …`). No `(united)`, no “was !N”.

## Description must NOT include

- Stacked / superseded / “unites !A + !B” / “rebased onto main”
- **Genealogy / remap noise:** `Replaces: !N (…)`, `Replaces !N`, closed predecessor branch names, ClickUp “(replaces VLT-old)”, “id rewrite”, “Prior united MR”, “was !N”
- Andx / agent / skill / worktree / plan-slug process talk
- Agent-host blockers (“Blocked on this agent host”, “no Xcode on this machine”) — put in chat, not MR body
- Paths or ADRs **not in this MR’s diff** (no “ADR lives in other repo” / `out-of-repo` unless that file is committed here). Same rule for in-MR `knowledge/` / runbook links.
- “Supersedes”, “do not merge old MR”, force-push notes
- Reviewer homework about out-of-tree docs
- Broken Suggested-review blob links (commit SHA mangled into path, wrong branch) — fix to `/-/blob/<urlencoded-source-branch>/<path>` or omit the line

**Lean Related:** current ClickUp task + **still-open** peer MRs / current stack Depends only. No closed remap predecessors.

## Lean diff (before open / before push)

Drop from the branch (restore to target base) anything that is **not** required for the feature:

| Drop | Keep |
|------|------|
| Pure `errcheck` `_ = Encode` / `defer _ = Close` — even in files this MR already edits | Error handling only on **new** lines you introduce, and only if surrounding new code already checks that error (do not wrap a whole file’s old Encodes) |
| Essay comments / `_ = displayedCurrency` on unused params | Leave original comments; unused params need no blank-ident |
| Unrelated handler/adapter/middleware churn | Feature wiring (`cmd/server`, config for new chain, etc.) |
| Agent artifacts (`.cursor/reviews/*`) | Product docs/runbooks **in** the diff |
| CI hacks whose only job is hiding fleet lint debt (`--new-from-rev` scope) | Real linter fixes for code this MR introduces |
| Drive-by a11y / import-only churn in files not needed for the feature | A11y required by the feature UX itself |
| `ADR-NNN` / out-of-repo doc cites and essay comments in source ([CODE-COMMENTS](../andx-execute/CODE-COMMENTS.md)) | ≤2-line plain-English *why*; ADRs only under in-repo `docs/`/`knowledge/` committed here |
| Harness jargon in source/runbooks: `ponytail:`, `shrink:`, `andx:`, skill names, `andx/exec-*` branch pins | Plain English; pin public MR branches/tags + “record commit →” |
| Comments/runbook lines that only make sense if you saw the agent chat | Rewrite for a first-time reviewer |
| Comments claiming config is optional while Load requires it | Comment matches `getEnvRequired` / fail-closed |
| Console logs of partyName / truncated identity | Presence flags only |

**Pre-push:** run both [CODE-COMMENTS](../andx-execute/CODE-COMMENTS.md) gates — diff jargon grep on `base...HEAD`, and the MR/commit text gate on commit messages plus the drafted title/body; fix hits before open/push/edit.

Report dropped paths in the chat (short). Do not narrate in the MR body.

## Hosts

Use [HOSTS.md](../andx-mr-review/HOSTS.md). Prefer SSH remotes when HTTPS tokens fail. Do not print tokens.

## After create

- Do **not** merge unless user asks.
- Optional next: `/andx-mr-review` then `/andx-mr-babysit` for comments + CI.
- If branch rename needed later: GitLab cannot retarget source branch → push new `{user}/{slug}`, open new MR, close old with note, delete old branch; rewrite Related + blob links.
