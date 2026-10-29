# Host CLI reference

Commands for `/andx-mr-review` (alias `/andx-pr-review`). Prefer host CLIs over raw curl.

CI waits: one blocking wait per host (below), run as a background shell ([HARNESS.md](../andx-orchestration/HARNESS.md) long-wait row). Never poll in short model turns: each turn re-reads the whole context.

## GitLab (`glab`)

### Auth

```bash
glab auth login --hostname gitlab.example.com --token glpat-xxx
glab config set ssh_host ssh.gitlab.example.com --host gitlab.example.com
glab auth status
```

If remote is `ssh.gitlab.example.com` but API host is `gitlab.example.com`, set `ssh_host` or MR checkout fails.

### Resolve + fetch

```bash
# URL: https://host/group/repo/-/merge_requests/17
glab mr view 17 -R group/repo
glab mr diff 17 -R group/repo --color=never
glab api projects/:id/merge_requests/17
glab api projects/:id/merge_requests/17/pipelines
glab mr note list 17 -R group/repo
glab ci status --live -b <head_branch> -R group/repo   # blocking CI wait
```

From repo with matching remote, omit `-R`.

### Inline positions (for API)

```bash
glab api projects/:id/merge_requests/17/versions
# use base_commit_sha, head_commit_sha, start_commit_sha
```

### Post comments

```bash
# Summary (non-resolvable)
glab mr note create 17 -R group/repo --resolvable=false -m "…"

# Inline
glab mr note create 17 -R group/repo --file src/Foo.tsx --line 42 -m "…"

# Thread reply
glab mr note create 17 -R group/repo --reply <discussion-id-prefix> -m "…"

# Update (append only — do not rewrite user text)
glab mr note update 17 <note-id> -R group/repo -m "<original>\n\n```tsx\n…\n```"
```

Nitpick severity: GitLab REST may not set UI nitpick badge — use `**nitpick:**` prefix in body.

### Artifact on branch

```bash
git show origin/feat/branch:.cursor/reviews/plan-slug.json
```

## GitHub (`gh`)

### Auth

```bash
gh auth status
```

### Resolve + fetch

```bash
gh pr view 17 --json title,body,state,headRefName,baseRefName,commits,url
gh pr diff 17
gh pr checks 17
gh pr checks 17 --watch --interval 60   # blocking CI wait
gh api repos/:owner/:repo/pulls/17/comments
```

### Post comments

```bash
# General comment
gh pr comment 17 --body "…"

# Review comment (inline) — use gh api for line-level:
gh api repos/:owner/:repo/pulls/17/comments -f body="…" -f commit_id=… -f path=… -F line=…
```

## Bitbucket / generic fallback

1. Parse MR URL if possible; else ask for repo path + MR id
2. `git fetch origin pull/<id>/head:pr-<id>` or branch name
3. `git diff base...pr-<id>`
4. **Post:** draft-only in v1 unless `BITBUCKET_TOKEN` + API documented — chat report + comment drafts for manual paste
5. **CI wait:** one shell loop, ≥ 5 min between checks: `while curl -fsS -H "Authorization: Bearer $BITBUCKET_TOKEN" "https://api.bitbucket.org/2.0/repositories/<ws>/<repo>/commit/<head_sha>/statuses" | rg -q '"INPROGRESS"'; do sleep 300; done`

## MCP fallback

If `plugin-gitlab-GitLab` MCP is healthy, prefer MCP for `get_merge_request` / diffs; fall back to `glab` on error.

## Duplicate run guard

```bash
glab mr note create 17 -m "…" --unique
```

Reads existing notes; skips if body matches.
