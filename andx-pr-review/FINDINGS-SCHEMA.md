# REVIEW-ARTIFACT schema

Shared between `/andx-execute-and-review` (writer) and `/andx-pr-review` (reader).

**Path:** `<repo>/.cursor/reviews/<plan-slug>.json` — commit on branch so MR head carries it.

## Top-level

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema_version` | number | yes | `1` |
| `source` | string | yes | `andx-execute-and-review` |
| `plan` | string | yes | e.g. `.cursor/plans/foo.plan.md` |
| `target_branch` | string | yes | e.g. `main` |
| `head_sha` | string | yes | full commit SHA reviewed |
| `reviewed_at` | string | yes | ISO-8601 |
| `verdict` | string | yes | `PASS` \| `BLOCK` |
| `findings` | array | yes | may be empty on clean PASS |

## Finding object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | stable slug e.g. `provider-init-race` |
| `severity` | string | yes | `high` \| `medium` \| `low` \| `nitpick` |
| `location` | string | yes | `path:line` |
| `finding` | string | yes | one-line summary |
| `ux_flow` | string | no | numbered user journey |
| `api_note` | string | no | method/body/server vs client |
| `fix_snippet` | string | no | code block content without fences |
| `confidence` | string | no | `confirmed` \| `needs-backend-confirmation` |
| `reviewers` | string[] | no | e.g. `["bugbot","ux-api"]` |

## Example

```json
{
  "schema_version": 1,
  "source": "andx-execute-and-review",
  "plan": ".cursor/plans/compliance-ui.plan.md",
  "target_branch": "main",
  "head_sha": "009bd59e42bd5a5b41a77b969a0d4e5b3a060b2f",
  "reviewed_at": "2026-07-07T06:00:00Z",
  "verdict": "PASS",
  "findings": [
    {
      "id": "validate-stored-key-only",
      "severity": "medium",
      "location": "src/components/Settings/ComplianceSettings.tsx:300",
      "finding": "Validate tests stored key only; button disabled when no hasApiKey",
      "ux_flow": "1. User types draft key\n2. Validate disabled\n3. Must Save before validate",
      "api_note": "POST .../validate has no body; uses server-stored key",
      "fix_snippet": "disabled={(!hasApiKey && !apiKey.trim()) || isValidating}",
      "reviewers": ["bugbot", "ux-api"]
    }
  ]
}
```

## pr-review consumption

1. Read `.cursor/reviews/*.json` on MR head (via checkout or `git show <sha>:path`)
2. If `head_sha` === MR head SHA → **skip subagents** (`--from-artifact` behavior)
3. Map each finding → REPORT-FORMAT block + COMMENT-STYLE MR draft
4. If stale or missing → full discovery stack
