---
name: andx-execute-review-and-deploy
description: "/andx-execute-review-and-deploy: andx-execute-and-review, push, then andx-deploy with health checks. Use for \"execute, review, and deploy\" or \"ship it\"."
disable-model-invocation: true
effort: medium
---
# Andx Execute, Review, and Deploy

Alias of `/andx-execute-and-review --deploy`: follow [/andx-execute-and-review](../andx-execute-and-review/SKILL.md) with `--deploy` on the given plan; it reads [/andx-deploy](../andx-deploy/SKILL.md) after landing. First CI/CD → `/andx-deploy-init` (no deploy).
