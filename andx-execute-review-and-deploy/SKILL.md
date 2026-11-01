---
name: andx-execute-review-and-deploy
description: "/andx-execute-review-and-deploy: andx-execute-and-review, push, then andx-deploy with health checks. Use for \"execute, review, and deploy\" or \"ship it\"."
disable-model-invocation: true
effort: medium
---
# Andx Execute, Review, and Deploy

Alias of `/andx-execute-and-review --deploy`: follow [/andx-execute-and-review](../andx-execute-and-review/SKILL.md) with `--deploy` on the given plan. First CI/CD → `/andx-deploy-init` (must not auto-deploy).

Ledger: `node "$S/run.mjs" start --slug "$SLUG" --mode review-deploy`; phases `A` (worker pass), then `A′` (push), `B`, `C`, `D` per [/andx-deploy](../andx-deploy/SKILL.md), which it reads after review PASS and cleanup evidence; it keeps the ship-queue lock until fresh health. `run.mjs end` prints the status line that ends the reply.
