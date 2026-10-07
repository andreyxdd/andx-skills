---
name: andx-deploy-init
description: "/andx-deploy-init: first-time production CI/CD setup via grill, human checklist, and a review-gated plan. Use for \"set up CI/CD\" or \"bootstrap deployment\"."
disable-model-invocation: true
---
# Andx Deploy Init

Prepare a target app repo for first production CI/CD. Do not implement CI, deploy, or handle secret values here.

Skill routing: [SKILL-MAP.md](../andx-orchestration/SKILL-MAP.md) · [CHECKLIST.md](./CHECKLIST.md) · [PLAN-TEMPLATE.md](./PLAN-TEMPLATE.md)

## Required companions

| Skill | Role |
|---|---|
| [/grilling](../grilling/SKILL.md) | Deploy/CI grill; ADR rules |
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Worktree and merge awareness |
| [/andx-execute-and-review](../andx-execute-and-review/SKILL.md) | Review-gated CI/CD implementation |
| [/andx-deploy](../andx-deploy/SKILL.md) | Pair only after merged CI/CD |
| `github-workflows` | Discover existing CI/workflow patterns when needed |

## Workspace gate

Before Phase A reads or writes, confirm Cursor workspace is target app repo. If not, call `move_agent_to_root` from `cursor-app-control` with target repo path. Never read or write target `.cursor/plans/` from a different workspace root.

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

Use `/grilling` rules (rounds: whole frontier at once, recommended answer per question; secrets never asked in chat). Explore source before asking questions whose answer is already documented.

### B. ADR

Offer/write an ADR only for a hard-to-reverse, surprising decision with a real trade-off. ADRs belong in the **target app repo** under `docs/adr/`, never this skills repo.

### C. Manual checklist

Present [CHECKLIST.md](./CHECKLIST.md) as a human checklist. Steps with secrets or third-party dashboards → generate a wizard per `~/.cursor/skills/wizard/SKILL.md` (copy its `template.sh`, one stage per step, `ask_secret` for secrets, `set_secret` names matching CI `secrets.*`), verify with `bash -n`, and hand the user the run command; do not run it yourself. Pause until user confirms it is complete. Never print or request production secret values in chat.

### D. Write CI/CD plan

After checklist confirmation, write target repo `.cursor/plans/<slug>-cicd.plan.md`, based on [PLAN-TEMPLATE.md](./PLAN-TEMPLATE.md). Plan must include `andx_ready: true`, concrete `depends`, `touch`, and falsifiable verification.

### E. User confirms plan

Show plan path and wait for explicit approval. Do not begin implementation before approval.

### F. Execute with review

Read `../andx-execute-and-review/SKILL.md` and follow it on the approved CI/CD plan. Do not use plain `/andx-execute`, `/andx-execute-and-deploy`, or `/andx-execute-review-and-deploy`: first-time CI/CD must not auto-push or deploy production.

### G. Stop

After reviewed merge and verification, stop. Suggest `/andx-deploy` for a separate production deployment. Do not auto-run it.

## Anti-patterns

- Skipping checklist or plan confirmation
- Implementing CI/CD before checklist confirmation
- Using plain `/andx-execute` for first-time CI/CD
- Using `/andx-execute-and-deploy` or `/andx-execute-review-and-deploy`; only `/andx-execute-and-review` implements this plan
- Auto-deploying after merge
- Putting production secret values in chat, plans, commits, or ADRs
- Echoing private keys or weakening SSH host verification

## Next

- Before merge: `/andx-execute-and-review` only.
- After reviewed merge: suggest `/andx-deploy`; never auto-run it.
