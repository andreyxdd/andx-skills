---
name: andx-mr-create
description: "/andx-mr-create: open an MR/PR with a lean diff and a reviewer-facing description (summary, review order, test plan). Use for \"open an MR\" or \"create merge request\"."
disable-model-invocation: true
---
# Andx MR Create

Open one merge-ready **description + branch** for human review. Standards: [STANDARDS.md](./STANDARDS.md).

Routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · Hosts: [HOSTS.md](../andx-mr-review/HOSTS.md)

## vs siblings

| Skill | Job |
|-------|-----|
| **`andx-mr-create`** | Branch name + lean tip + open MR + description |
| `andx-mr-review` | Review comments only |
| `andx-mr-babysit` | Fix conflicts / comments / CI after MR exists |

Do not babysit inside create unless user also asked. Do not merge unless asked.

## When to use

- `/andx-mr-create` (optional: repo path, base branch, slug hint)
- “create/open an MR/PR” for current work
- After execute when user wants the remote review artifact

**Not for:** review-only, babysit-only, force-push to `main`/`master`.

---

## Workflow

### 1. Auth + repo

- Detect host from `origin` (GitLab / GitHub). Auth via HOSTS.
- Confirm clean intent: working tree for the MR tip (prefer worktree). Stash only with user OK if dirty unrelated files.

### 2. Derive `{username}`

Per STANDARDS: host account handle of `origin` (`glab api user` → `.username` / `gh api user` → `.login`) → repo-local `andx.mr-username` → ask. Handles differ per host. Never `$USER`, OS login, existing branch prefixes, or `andx/`.

### 3. Choose `{mr-slug}` + branch

- Short kebab product slug. If user gave a name, normalize to kebab under `{username}/`.
- If tip is already on a wrong-shaped branch (`andx/…`, `exec-…`, `*-united`): create `{username}/{slug}` from tip, push, use that as source (do not leave process names as source).

### 4. Lean the tip

Against target (`main` / `develop` / stated base):

1. List `git diff --name-only origin/<base>...HEAD`
2. Drop files / hunks that fail STANDARDS lean table (restore from base)
3. Commit `chore: drop unrelated noise from MR` if anything dropped
4. Push source branch (`-u` if new)

### 5. Open MR

- Title: conventional, product-facing
- Body: STANDARDS sections only — **no** `Replaces:` / genealogy / agent-host notes (see STANDARDS “must NOT”)
- **Suggested review order:** only paths in the final diff; each with blob link on **source branch**
- **Related:** other **open** service MR URLs if known; omit section if none
- Target = agreed base
- Draft only if user asked or CI/tests known broken

GitLab example:

```bash
glab mr create -R <group>/<repo> \
  --source-branch "$MR_USERNAME/$SLUG" \
  --target-branch main \
  --title "feat(scope): …" \
  --description "$(cat <<'EOF'
…
EOF
)"
```

GitHub: `gh pr create` equivalent.

### 6. Return

Chat reply (short):

- MR/PR URL
- `source → target`
- Dropped noise paths (if any)
- Optional: “next `/andx-mr-babysit <url>` for CI/comments”

### 7. Rename later

If user renames branch after open: GitLab cannot change source branch → new branch + new MR + close old with supersede note + delete old remote branch + rewrite Related/blob links. Do not leave dead `andx/*` remotes.

---

## Anti-patterns

- Branch `andx/exec-*` / `*-united` as final source
- Description mentions stacked MRs, andx, rebase, “was !N”
- Blob links to files not in the diff
- Shipping fleet-wide errcheck/`Encode` silence as the MR story
- Printing tokens / HTTPS remotes with embedded credentials
- Merging without explicit ask
