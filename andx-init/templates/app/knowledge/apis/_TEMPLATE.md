---
type: api
name: API name
status: draft
---

# API name

## Callers

Who calls this surface (internal service, mobile, public third-party, same-repo frontend).

## Versioning

None | URL path (`/v1/`) | header | GraphQL schema evolution.

## Auth

Public | API key | OAuth | session | mTLS | internal-only.

## Endpoints

| Method | Path | Intent | Success | Errors |
|--------|------|--------|---------|--------|
| POST | /v1/example | Create resource | 201 + Location | 400, 401, 422 |

### Request / response shapes

Per endpoint: body, query params, response body, pagination (if list).

## Error shape

Consistent error envelope; no 200-with-error-body.

## Idempotency

Retry-safe operations; idempotency keys if required.
