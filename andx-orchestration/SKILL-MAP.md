# Andx skill map

Single source of truth for routing Cursor companion skills into the andx stack. Each andx `SKILL.md` links here instead of duplicating full tables.

**Principle:** invoke skills by path (`~/.cursor/skills/<name>/SKILL.md` or `~/.cursor/skills-cursor/…`); capture outputs in OKF `knowledge/` and plan frontmatter.

## Upstream (before `/andx-plan`)

| Skill | Trigger | Outcome |
|-------|---------|---------|
| `write-a-prd` | Greenfield feature, no PRD | PRD doc → feed into `/andx-plan` |
| `grill-me` | Plan still hand-wavy after Phase 0 anchor | Blocks planning until decisions resolved |
| `grill-with-docs` | Domain fuzzy (andx-plan Phase 1) | `knowledge/domain/*` |

## Plan phase (`/andx-plan`)

| Skill | Trigger | Artifact |
|-------|---------|----------|
| `design-an-interface` | New module/boundary; shape not obvious | `knowledge/modules/<slug>.md` |
| `api-design` | HTTP/GraphQL surface (routes, handlers, schema) | `knowledge/apis/<slug>.md` |
| `create-mcp-server` | Plan adds MCP tools | `knowledge/apis/mcp-<slug>.md` |
| `accessibility` | UI steps with a11y requirements | step `success` + verification |
| `impeccable` | UI/UX-heavy steps | design notes in plan step |
| `andx-init` | `knowledge/` missing | OKF + ICM scaffold |

Plan frontmatter: `design_pass`, `design_refs`, `companion_skills` — see [PLAN-FORMAT.md](../andx-plan/PLAN-FORMAT.md).

## Execute phase (`/andx-execute`)

| Skill | Trigger | When |
|-------|---------|------|
| `tdd` | Steps with falsifiable contract | Worker Phase 1+ |
| `test` / `lint` | Toolchain discovered in preflight | Phase 3 evidence |
| `react-best-practices` | `REACT_STACK` + React touch paths | Worker Phase 1 |
| `impeccable` | `kind: ui` \| `mixed` | Worker Phase 1 |
| `observability` | New service, job, or background worker | Step success includes logs/health |
| `agent-browser` | UI verification needs browser | Step verification |
| `dependency-upgrade` | Upgrade-only plan or deps step | Dedicated plan scope |

Load `design_refs` from plan as **immutable contract** in orchestrator preflight and worker prompt.

## Review phase (`/andx-execute-and-review`)

| Skill | Trigger | When |
|-------|---------|------|
| `review` | Always | Reviewer 1 |
| `security-review` | Auth, input, external surface, secrets, LLM | Reviewer 2 (conditional) |
| `ponytail-review` | Always | Reviewer 3 |
| `ponytail-audit` | Diff adds deps or new files under `touch` | Reviewer 4 (conditional) |
| `react-best-practices` | Diff touches React paths | Reviewer 5 (conditional) |
| `accessibility` | UI diff + plan has a11y in `companion_skills` or step `success` | Reviewer 6 (conditional) |
| `web-quality-audit` | Marketing/landing page plans | Post-merge optional |

All reviewers: endpoint/module shape drift vs `design_refs` = **HIGH → BLOCKS**.

## Debug phase (`/andx-debug-and-fix`)

| Skill | Trigger | When |
|-------|---------|------|
| `debug-like-expert` | Unknown root cause | Phase B readonly analyst |

## Deploy phase (`/andx-deploy`)

| Skill | Trigger | When |
|-------|---------|------|
| `github-workflows` | Deploy method unclear; CI discovery | Preflight Phase B |

## Out of scope

`short`, `btw`, `caveman-*`, `dlc-meeting-summary`, `qa` — meta or unrelated workflows; not routed through andx.

## Knowledge templates

When Phase 1.5 creates first API/module doc, copy from:

- `andx-init/templates/app/knowledge/apis/_TEMPLATE.md`
- `andx-init/templates/app/knowledge/modules/_TEMPLATE.md`
