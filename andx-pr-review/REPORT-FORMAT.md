# Chat report format (`/andx-pr-review`)

Teaching-depth output for the invoker. MR comments stay short per [COMMENT-STYLE.md](./COMMENT-STYLE.md).

## Header

```markdown
## PR review — <host> <owner/repo> !<iid|#n>

**MR:** <url>
**Branch:** `<source>` → `<target>`
**Head:** `<sha short>`
**Mode:** full | --from-artifact | --fast | --deep
**CI:** <pass|fail|manual> — <pipeline url if failed>
```

## Summary table

| Severity | Location | Finding | Post? |
|----------|----------|---------|-------|
| high | `path:line` | one line | inline draft |

Sort by severity: high → medium → low → nitpick.

## Per-finding block

Repeat for each finding (from subagents or `REVIEW-ARTIFACT.json`):

```markdown
### <severity> — <short title>

**Location:** [`path:line`](<host-url-to-line-if-possible>)
**Finding:** <what is wrong>

#### UI/UX flow
<Step-by-step user journey when this is a form, button, or status display issue. Use numbered steps. Omit section if N/A.>

Example pattern:
1. User opens Settings → Compliance
2. User types API key (draft in field, not saved)
3. Validate is disabled (`!hasApiKey`)
4. User expects validate-before-save; actual flow requires Save first

#### API contract
<Method, path, request body, what server vs client holds. Omit if N/A.>

Example:
- `POST /governance/v1/.../validate` — no body; tests **stored** key only
- Draft key lives in React state until `PUT .../settings` with `api_key`

#### Fix snippet
```tsx
// minimal fix
```

**MR comment draft:** <compressed version for host, per COMMENT-STYLE>
**Confidence:** confirmed | needs-backend-confirmation
```

## Footer

```markdown
## Posting plan

- Summary note: yes/no
- Inline threads: N (list paths)
- Nitpicks: M (post only if user confirms)

## Artifact

- Source: subagents | `.cursor/reviews/<slug>.json` (head_sha match)
- Subagents skipped: yes/no
```

## Export

Optional write: `<workspace>/.cursor/reviews/<mr-id>-report.md` for search/audit.
