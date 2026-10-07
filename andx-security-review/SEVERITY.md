# Severity (andx-security-review)

Anchors adapted from Cloudflare security-audit (MIT, `references/cloudflare/`).

## Rules

1. **Only proven findings get severity.** `needs_validation` has none; `rejected` has none.
2. **Overall ≤ demonstrated impact.** Likelihood never raises severity above what the trace shows.
3. **Cannot state the concrete damage → severity is lower than it feels.**
4. **High vs medium:** does the result *fully defeat* an explicit control for an action with real consequences (high), or only *weaken* it (medium)?

## Anchors

| Severity | Anchor |
|----------|--------|
| critical | Unauthenticated actor gains code execution, full data-store access, or takeover of arbitrary accounts |
| high | Full defeat of an explicit control with real consequences: auth bypass, cross-tenant read/write, stored XSS on other users, authenticated RCE, unauthenticated remote stop of a shared service; (andx addition) unauthorized transfer of funds or use of signing keys |
| medium | Real boundary violation with limited blast radius, uncommon preconditions, or a narrow resource set |
| low | Non-secret internals disclosed, or effect needing sustained effort for minimal gain |
| informational | Confirmed but minimal; mostly a prerequisite inside a larger chain (artifact: `low`) |

## Reachability tiers (state one per finding)

`public-unauth` → `authenticated-user` → `cross-tenant` → `adjacent/same-host` → `admin-only` → `local-only`.
An issue reachable only from `admin-only` or `local-only` rarely exceeds medium unless the admin boundary itself is the control being defeated.

## Gate mapping (andx)

| Finding status | critical/high | medium | low |
|----------------|---------------|--------|-----|
| `confirmed` | **BLOCK** | fix in round when in scope (execute-and-review MEDIUM policy) | advisory |
| `needs_validation` | advisory, always surfaced with blocker + validation plan | advisory | advisory |
| `rejected` | recorded; later rounds skip the same fingerprint | — | — |
