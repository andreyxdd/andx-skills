---
name: andx-deploy-init
description: Bootstrap first-time production CI/CD through a one-question-at-a-time deploy grill, human infrastructure checklist, and review-gated execution plan. Use for /andx-deploy-init, "set up CI/CD", "first production deploy", or "bootstrap deployment".
---

# Andx Deploy Init

Prepare a target app repo for first production CI/CD. Do not implement CI, deploy, or handle secret values here.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · [CHECKLIST.md](./CHECKLIST.md) · [PLAN-TEMPLATE.md](./PLAN-TEMPLATE.md)

## Required companions

| Skill | Role |
|---|---|
| [/grill-with-docs](../grill-with-docs/SKILL.md) | One-question deploy/CI grill; ADR rules |
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Worktree and merge awareness |
| [/andx-execute-and-review](../andx-execute-and-review/SKILL.md) | Review-gated CI/CD implementation |
| [/andx-deploy](../andx-deploy/SKILL.md) | Pair only after merged CI/CD |
| `github-workflows` | Discover existing CI/workflow patterns when needed |

## Workflow

```
A. Grill → B. ADR when qualified → C. Manual checklist → pause
D. Write CI/CD plan → E. User confirms plan → F. Execute + review → G. Stop
```

### A. Grill

Read target repo context and current deploy/CI artifacts. Ask one question at a time. Give a recommended answer. Resolve:

- deployment target, runtime, registry, reverse proxy, and health endpoint;
- deploy trigger, rollback method, migration/backup policy, and required CI checks;
- environment separation and where secrets live.

Use `/grill-with-docs` rules. Explore source before asking questions whose answer is already documented.

### B. ADR

Offer/write an ADR only for a hard-to-reverse, surprising decision with a real trade-off. ADRs belong in the **target app repo** under `docs/adr/`, never this skills repo.

### C. Manual checklist

Present [CHECKLIST.md](./CHECKLIST.md) as a human checklist. Pause until user confirms it is complete. Never print or request production secret values in chat.

### D. Write CI/CD plan

After checklist confirmation, write target repo `.cursor/plans/<slug>-cicd.plan.md`, based on [PLAN-TEMPLATE.md](./PLAN-TEMPLATE.md). Plan must include `andx_ready: true`, concrete `depends`, `touch`, and falsifiable verification.

### E. User confirms plan

Show plan path and wait for explicit approval. Do not begin implementation before approval.

### F. Execute with review

Invoke `/andx-execute-and-review` on approved CI/CD plan. Do not use plain `/andx-execute`.

### G. Stop

After reviewed merge and verification, stop. Suggest `/andx-deploy` for a separate production deployment. Do not auto-run it.

## Anti-patterns

- Skipping checklist or plan confirmation
- Implementing CI/CD before checklist confirmation
- Using plain `/andx-execute` for first-time CI/CD
- Auto-deploying after merge
- Putting production secret values in chat, plans, commits, or ADRs

## Optional pairing

| Situation | Skill |
|---|---|
| Workflow conventions unclear | `/github-workflows` |
| CI/CD plan implementation | `/andx-execute-and-review` |
| Merged revision ready to ship | `/andx-deploy` |
