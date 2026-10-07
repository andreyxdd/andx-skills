# REVIEW-ARTIFACT schema (v2; v1 still readable)

Shared between `/andx-execute-and-review` (writer) and `/andx-mr-review` (reader).

**Path:** `<repo>/.cursor/reviews/<plan-slug>.json`, committed on the branch so the MR head carries it.
**Validate:** `node ~/.cursor/skills/andx-mr-review/scripts/validate-review-artifact.mjs <file> --head <MR head SHA> --base <MR base SHA>` → `TRUSTED` | `READABLE[: reason]` | `INVALID` (exit 1).

## Top-level

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema_version` | number | yes | `2` for new artifacts; readers accept `1` and `2`, reject anything else |
| `source` | string | yes | `andx-execute-and-review` \| `andx-mr-review` \| `andx-security-review` |
| `plan` | string | yes | e.g. `.cursor/plans/foo.plan.md` |
| `target_branch` | string | yes | e.g. `main` (stacked MR: parent MR branch) |
| `base_sha` | string | v2 | full SHA of `MERGE_BASE_SHA` the reviewers judged from |
| `head_sha` | string | yes | full SHA reviewed (`EXEC_HEAD`) |
| `reviewed_at` | string | yes | ISO-8601 |
| `verdict` | string | yes | `PASS` \| `BLOCK` |
| `secrets_scan` | string | no | `RAN` \| `NOT_RUN` |
| `findings` | array | yes | may be empty on clean PASS |

## Finding object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | stable root-cause fingerprint, `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$` (no line, round, severity) |
| `status` | string | v2, default `confirmed` | `confirmed` \| `needs_validation` \| `rejected` (security meaning; not fix state) |
| `severity` | string | confirmed only | `critical` \| `high` \| `medium` \| `low` \| `nitpick`; absent for needs_validation/rejected |
| `resolution` | string | no | `fixed` \| `deferred` \| `accepted` (fix state) |
| `location` | string | yes | `path:line` |
| `finding` | string | yes | one-line summary |
| `reachability` | string | no | tier from andx-security-review SEVERITY.md |
| `trace` | string[] | no | `path:line — operation`, entrypoint first, sink last |
| `conditions` | string[] | no | preconditions the result depends on |
| `blockers` | string[] | needs_validation | exact missing facts |
| `validation_plan` | string | needs_validation | non-destructive local or owner-observed check |
| `ux_flow` / `api_note` / `fix_snippet` | string | no | as before |
| `reviewers` | string[] | no | e.g. `["bugbot","security","spec"]`; tracks unique catches |

**Consistency:** `verdict: PASS` with a `confirmed` critical/high requires `resolution: fixed`. v1 readers: `severity` case-insensitive; v1 `status`/`confidence` are informational only.

## Example (v2)

```json
{
  "schema_version": 2,
  "source": "andx-execute-and-review",
  "plan": ".cursor/plans/compliance-ui.plan.md",
  "target_branch": "main",
  "base_sha": "4b1e0c3d9f2a7e6b5c8d1a0f3e2b7c6d5a4f3e2b",
  "head_sha": "009bd59e42bd5a5b41a77b969a0d4e5b3a060b2f",
  "reviewed_at": "2026-10-07T06:00:00Z",
  "verdict": "PASS",
  "secrets_scan": "NOT_RUN",
  "findings": [
    {
      "id": "validate-stored-key-only",
      "status": "confirmed",
      "severity": "medium",
      "resolution": "deferred",
      "location": "src/components/Settings/ComplianceSettings.tsx:300",
      "finding": "Validate tests stored key only; button disabled when no hasApiKey",
      "reviewers": ["bugbot", "ux-api"]
    },
    {
      "id": "xff-client-ip-trust",
      "status": "needs_validation",
      "location": "src/api/rateLimit.ts:12",
      "finding": "Rate limit keys on X-Forwarded-For; safe only if the ingress overwrites it",
      "blockers": ["ingress XFF handling not in repo"],
      "validation_plan": "Owner checks ingress config for XFF overwrite",
      "reviewers": ["security"]
    }
  ]
}
```

## mr-review consumption

1. Read `.cursor/reviews/*.json` on the MR head (`git show <sha>:path`).
2. Run the validator with MR head and base. **`TRUSTED` only** → skip reviewer subagents (`--from-artifact`).
3. `READABLE` (v1, or head/base mismatch) → run the full reviewer stack; prior findings may seed the report but never replace review.
4. `INVALID` or missing → full reviewer stack.
5. Map findings → REPORT-FORMAT blocks + COMMENT-STYLE drafts; `needs_validation` → question to the author, never a blocker; `rejected` → not posted.
