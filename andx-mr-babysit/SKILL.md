---
name: andx-mr-babysit
description: >-
  Keep a remote MR/PR merge-ready — parse URL, auth preflight, then loop on merge
  conflicts, unresolved comments, and CI until green (or escalate). GitHub with
  Cursor babysit present: delegate after checkout. Else andx-owned gh/glab loop
  via HOSTS. Use for /andx-mr-babysit, MR URL + "babysit", or after push when
  user wants merge-ready (not review-only).
disable-model-invocation: true
---

# Andx MR Babysit

Drive a remote MR/PR to **merge-ready**: conflicts resolved, comments triaged, CI green in PR scope.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md)

Host CLIs: [HOSTS.md](../andx-mr-review/HOSTS.md) (shared with mr-review — do not fork).

## vs `/andx-mr-review`

Alias `/andx-pr-review`. Review vs babysit stay two skills.

| Skill | Job |
|-------|-----|
| `andx-mr-review` | **Review** + draft/post comments (teaching report). Does **not** implement fixes. |
| `andx-mr-babysit` | **Fix toward merge** — conflicts, valid comments, CI in PR scope. |

Review findings first → then babysit. Do not use babysit as a substitute for review.

## When to use

- `/andx-mr-babysit <MR-or-PR-URL>`
- MR/PR URL + "babysit" / "make merge-ready"
- After push when user wants green + comment-cleared, not another review pass

**Not for:** posting review comments only (`/andx-mr-review`); local execute gates (`/andx-execute-and-review`); merging/closing the MR unless user explicitly asks.

## Required companions

| Path | Role |
|------|------|
| [HOSTS.md](../andx-mr-review/HOSTS.md) | Parse URL; `gh` / `glab` / Bitbucket fallback |
| [babysit](~/.cursor/skills-cursor/babysit/SKILL.md) | Prefer when present + GitHub |

---

## Workflow

### 1. Parse URL + progress checklist

From URL extract host (`gitlab` | `github` | `bitbucket`), `owner/repo`, MR/PR iid — see [HOSTS.md](../andx-mr-review/HOSTS.md).

Track in chat (update each loop):

```text
[ ] Auth OK
[ ] Branch checked out / fetchable
[ ] Merge conflicts
[ ] Unresolved comments (valid ones fixed or replied)
[ ] CI green (PR-scoped failures fixed)
[ ] Merge-ready (or escalated)
```

### 2. Auth preflight

Fail fast with setup hints:

- GitLab: `glab auth status` (+ `ssh_host` if SSH alias)
- GitHub: `gh auth status`
- Bitbucket: token/API readiness per HOSTS — often incomplete

Load MR metadata, head/base refs, pipeline/checks, open discussion threads.

### 3. Branch materialize

Fetch MR head; checkout working copy of head branch (stash only after user confirms if dirty). Record `base_sha` / `head_sha`.

### 4. Route: delegate vs andx-owned loop

**Delegate** when **all** true:

1. Host is **GitHub**
2. `~/.cursor/skills-cursor/babysit/SKILL.md` exists

Then: follow that skill verbatim for conflict / comments / CI loop. Keep this skill's checklist updated from babysit outcomes. Still use [HOSTS.md](../andx-mr-review/HOSTS.md) for any `gh` commands babysit implies.

**Else** (GitLab/`glab`, Bitbucket incomplete, or babysit missing): run **andx-owned loop** below — same three jobs as Cursor babysit.

### 5. Andx-owned loop (max bound)

**Max iterations:** 5 full passes (conflicts → comments → CI → push/recheck). After bound without merge-ready → **escalate** (stop; report blockers + what tried).

Each pass:

#### A. Merge conflicts

Intelligently resolve, preserving intent of both head and base. If intents conflict → abort merge, ask user. Prefer merge base latest into head over rewriting history unless user asked otherwise.

#### B. Unresolved comments

- Load active unresolved threads only (`glab mr note list` / `gh` review comments — filter resolved first).
- Read comment body + minimal location/URL; skip full JSON dumps.
- Validate Bugbot-like / automated findings: act only when valid; when disagree or unsure, reply explaining why and leave open or ask user.
- Implement clear fix requests in PR scope; reply when fixed.

#### C. CI

- Fix failures **caused by this PR's changes**.
- Never weaken CI checks/workflows just to pass; never unrelated refactors.
- Merge-blocking failure looks unrelated → check if branch behind base; merge latest base (another PR may have fixed it).
- Push scoped fixes; re-watch pipeline/checks until green or escalate.

Host commands: [HOSTS.md](../andx-mr-review/HOSTS.md) (`glab mr …`, `gh pr checks`, etc.).

### 6. Done / escalate

**Done when:** no conflicts, unresolved actionable comments triaged (fixed or explicitly disagreed with reply), CI green for merge-blocking checks.

**Escalate when:** max loops hit; intent conflict; CI needs workflow change; Bitbucket post/API incomplete; auth/permission wall; comment needs product decision.

Do **not** merge unless user explicitly requests.

---

## Anti-patterns

- Using this skill to only post review comments (use `/andx-mr-review`)
- Editing CI to silence failures
- Acting on invalid Bugbot noise without validating
- Infinite loop with no progress report
- Force-push / history rewrite without user ask
- Merging MR without explicit ask

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Need findings + MR comments first | `/andx-mr-review` → then `/andx-mr-babysit` |
| Local review gate before push | `/andx-execute-and-review` |
| GitHub + Cursor babysit installed | This skill wraps → delegates to babysit |
