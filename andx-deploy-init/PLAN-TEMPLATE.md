# CI/CD plan template

Write this file in target app repo as `.cursor/plans/<slug>-cicd.plan.md`. Adapt paths and commands from actual repo discovery.

```markdown
---
name: Bootstrap production CI/CD
overview: Add documented, review-gated build and deployment path for production.
andx_ready: true
domain_grilled: true
design_pass: skipped
workstream: mixed
pipeline_stage: 03-build
knowledge_refs: [knowledge/doc-sync-map.md]
design_refs: []
companion_skills: [github-workflows]
stack: none
source: thread
todos: []
isProject: false
---

# Bootstrap production CI/CD

## Execution steps

### step-1 — Document production operation
kind: docs
depends: []
touch: [docs/adr/, docs/deploy.md, knowledge/doc-sync-map.md]
success: ADR/runbook documents deploy trigger, rollback, health check, and secret ownership.
verification: npm run verify:docs

### step-2 — Add runtime deployment configuration
kind: mixed
depends: [step-1]
touch: [compose.prod.yml, Caddyfile, Dockerfile]
success: Production compose and reverse proxy expose only documented routes and health endpoint.
verification: docker compose -f compose.prod.yml config

### step-3 — Add remote deploy preflight
kind: backend
depends: [step-2]
touch: [scripts/deploy-remote.sh, scripts/deploy-preflight.sh]
success: Preflight fails before SSH deployment when required environment or health configuration is absent.
verification: make deploy-dry-run

### step-4 — Add CI and deployment workflows
kind: mixed
depends: [step-3]
touch: [.github/workflows/ci.yml, .github/workflows/deploy.yml]
success: CI validates revision and deploy workflow publishes GHCR image then deploys through SSH without exposing secrets.
verification: grep -q 'ghcr.io' .github/workflows/deploy.yml && grep -q 'ssh' .github/workflows/deploy.yml

### step-5 — Verify operator path
kind: docs
depends: [step-4]
touch: [docs/deploy.md, Makefile]
success: Runbook and dry-run command provide reproducible deploy and rollback steps.
verification: make deploy-dry-run

## Next

- `/andx-execute-and-review` on this plan
- After reviewed merge, `/andx-deploy` to ship a revision
```

Use detected stack (`react`, `next`, `react-next`, or `none`) and actual doc verifier. If target repo has no OKF bundle, use `knowledge_refs: []` and omit `pipeline_stage`.
