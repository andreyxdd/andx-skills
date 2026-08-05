# CI/CD plan template

Write this file in target app repo as `.cursor/plans/<slug>-cicd.plan.md`. Replace every placeholder with grill answers and discovered repository paths. Select only relevant steps: CI/CD need not use Docker Compose, Caddy, GHCR, SSH, or a VPS.

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

### step-2 — Add deployment configuration
kind: mixed
depends: [step-1]
touch: [<deployment-config-paths>]
success: Deployment configuration matches chosen runtime, network boundary, and health endpoint.
verification: <detected configuration validation command>

### step-3 — Add deployment preflight
kind: backend
depends: [step-2]
touch: [<deploy-script-or-platform-config>]
success: Preflight fails before deployment when required configuration or health settings are absent.
verification: <detected dry-run or validation command>

### step-4 — Add CI and deployment workflows
kind: mixed
depends: [step-3]
touch: [.github/workflows/<ci>.yml, .github/workflows/<deploy>.yml]
success: CI validates revision and selected deployment workflow uses secret references without exposing secret values.
verification: <workflow-specific static validation command>

### step-5 — Verify operator path
kind: docs
depends: [step-4]
touch: [docs/deploy.md, <operator-command-path>]
success: Runbook and dry-run command provide reproducible deploy and rollback steps.
verification: <detected dry-run command>

## Next

- `/andx-execute-and-review` on this plan
- After reviewed merge, `/andx-deploy` to ship a revision
```

Use detected stack (`react`, `next`, `react-next`, or `none`) and actual doc verifier. If target repo has no OKF bundle, use `knowledge_refs: []` and omit `pipeline_stage`.

## VPS + GHCR archetype (optional)

When grill answers select a Docker VPS and GHCR, substitute these concrete examples:

- runtime config: `compose.prod.yml`, `Caddyfile`, `Dockerfile`; verify `docker compose -f compose.prod.yml config --quiet`;
- deploy preflight: `scripts/deploy-remote.sh`, `scripts/deploy-preflight.sh`; verify `make deploy-dry-run`;
- workflows: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`; verify required `ghcr.io` and SSH references without printing secrets.

Never run rendered `docker compose ... config` with production `.env` in CI logs: interpolation can expose secrets. Use `config --quiet` or a dry-run that does not render environment values.
