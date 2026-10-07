# Andx skill map

Single source of truth for routing companion skills into the andx stack. Entry `SKILL.md` files link here — do not duplicate full tables.

**Principle:** invoke by path under `~/.cursor/skills/` or `~/.cursor/skills-cursor/` (built-ins only). Capture outputs in OKF `knowledge/` and plan frontmatter.

Harness spawn: [HARNESS.md](./HARNESS.md).

## Upstream (before `/andx-plan`)

| Skill | Trigger | Outcome |
|-------|---------|---------|
| `to-spec` (user-invoked) | Greenfield feature, no spec | spec → `/andx-plan` |
| `grill-me` (user-invoked) | Scope still hand-wavy after Phase 0 | Blocks until decisions resolved |
| `grilling` | Domain fuzzy (andx-plan Phase 1) | andx-plan writes `knowledge/domain/*` |

## Plan phase (`/andx-plan`)

| Skill | Trigger | Artifact |
|-------|---------|----------|
| `codebase-design` | New module/boundary | `knowledge/modules/<slug>.md` |
| `api-design` | HTTP/GraphQL surface | `knowledge/apis/<slug>.md` |
| `create-mcp-server` | Plan adds MCP tools | `knowledge/apis/mcp-<slug>.md` |
| `accessibility` | UI a11y requirements | step `success` + verification |
| `impeccable` | UI/UX-heavy steps | design notes in plan step |
| `andx-init` | `knowledge/` missing | OKF + ICM scaffold |

Frontmatter fields: [PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md).

**Docs workstream:** skip TDD; use `knowledge/doc-sync-map.md`; verify with repo doc script (`pnpm verify:docs` or equivalent).

## Schedule phase (`/andx-schedule`)

| Skill | Trigger | Artifact |
|-------|---------|----------|
| `andx-schedule` | ≥2 steps can share a wave (disjoint `touch`, deps satisfied); skip if 1 step / overlap / `touch: unknown` | `.cursor/plans/<slug>.EXEC-MATRIX.md` |

Before: `/andx-plan`. After: `/andx-execute` (or execute-and-review / execute-and-deploy / execute-review-and-deploy). Parent spawn: up to `max_parallel` (default 2) workers per wave; sequential orch Step 4 concurrent-merge + cleanup each `WORKTREE_DIR`.

## Execute phase (`/andx-execute`)

| Skill | Trigger | When |
|-------|---------|------|
| `tdd` | Falsifiable `backend`/`ui`/`mixed` steps | Worker Phase 1+ |
| `test` / `lint` | Toolchain from preflight | Phase 3 (lint always, even `DOCS_ONLY`) |
| Doc verifier | `kind: docs` / `workstream: docs`\|`mixed` | Doc gate + Phase 3 |
| `react-best-practices` | `REACT_STACK` + React paths | Worker Phase 1 |
| `impeccable` | `kind: ui`\|`mixed` | Worker Phase 1 |
| `observability` | New service/job/worker | Logs/health in success |
| `agent-browser` | UI needs browser | Step verification |
| `dependency-upgrade` | Upgrade-only plan | Dedicated scope |

Load `design_refs` as **immutable contract** in preflight + worker prompt.

Composer: `/andx-execute-review-and-deploy` = execute-and-review DoD (incl. concurrent-merge) → auto-push → `/andx-deploy`.

## Review phase (`/andx-execute-and-review`)

| Skill | Trigger | When |
|-------|---------|------|
| `review-bugbot` → bugbot | Always | Reviewer 1 |
| `andx-security-review` (gate) → agent `andx-security-reviewer` | Always; parent refutes each proposed critical/high with `andx-refuter`; Cursor `security-review` only under `--deep` | Reviewer 2 |
| `ponytail-review` | Always — [resolve](./HARNESS.md#ponytail-resolve) | Reviewer 3 |
| `ponytail-audit` | Diff adds deps or new files under `touch` | Reviewer 4 |
| `react-best-practices` | Diff touches React paths | Reviewer 5 |
| `accessibility` | UI diff + a11y in plan | Reviewer 6 |
| UX/API contract pass | UI forms + API client paths | Reviewer 7 (advisory unless paired HIGH) |

On **PASS**, write [REVIEW-ARTIFACT](../andx-mr-review/FINDINGS-SCHEMA.md) to `.cursor/reviews/<plan-slug>.json` on `EXEC_BRANCH` before merge.

`design_refs` drift = **HIGH → BLOCKS**.

### Severity maps (review)

| Source | Severity |
|--------|----------|
| Karpathy surgical scope violation | HIGH → BLOCKS |
| Karpathy speculative abstraction | MEDIUM → fix-or-justify |
| Ponytail new dependency (`native:`/`stdlib:`) | HIGH → BLOCKS |
| Other ponytail `yagni:`/`delete:`/`native:`/`stdlib:` | MEDIUM → fix-or-justify |
| Ponytail `shrink:` | LOW → advisory |
| Security `confirmed` critical/high | BLOCKS |
| Security `needs_validation` | advisory, always surfaced |
| React waterfall / barrel / RSC over-serialize | HIGH → BLOCKS |
| WCAG A/AA or missing keyboard path | HIGH → BLOCKS |

## Review external (remote MR)

| Skill | Trigger | When |
|-------|---------|------|
| `andx-mr-review` | MR URL | After push; **review** + draft/post comments; skips reviewers only when the artifact validator says `TRUSTED` (v2, head + base match) |
| `andx-mr-babysit` | MR URL + babysit / merge-ready | After push (or after mr-review) when conflicts/comments/CI must be **fixed** toward merge |

**Order:** review (`andx-mr-review`) → fix (`andx-mr-babysit`). GitHub + `~/.cursor/skills-cursor/autopilot` present → mr-babysit delegates to Cursor autopilot (formerly babysit) after auth/checkout; else andx-owned `gh`/`glab` loop via [HOSTS.md](../andx-mr-review/HOSTS.md).

| | `andx-mr-review` | `andx-mr-babysit` | Cursor `autopilot` |
|--|------------------|------------------|------------------|
| Job | Findings + comments | Merge-ready fixes | Same jobs as mr-babysit (GitHub-native) |
| Hosts | glab / gh / Bitbucket draft | Same HOSTS; Bitbucket may escalate | GitHub only |
| Implements code? | No | Yes (MR scope) | Yes |

## Debug / deploy

| Skill | Trigger |
|-------|---------|
| `debug-like-expert` | `/andx-debug-and-fix` Phase B |
| `andx-deploy-init` | First production CI/CD |
| `andx-deploy` | Ship committed revision |
| `andx-execute-review-and-deploy` | Execute + review gate + push + deploy |
| `github-workflows` | Deploy method unclear |

## Out of scope

`short`, `btw`, `caveman-*`, `dlc-meeting-summary` — not routed through andx.

## Knowledge templates

- `andx-init/templates/app/knowledge/apis/_TEMPLATE.md`
- `andx-init/templates/app/knowledge/modules/_TEMPLATE.md`
