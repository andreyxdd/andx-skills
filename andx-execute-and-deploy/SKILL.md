---
name: andx-execute-and-deploy
description: "/andx-execute-and-deploy: andx-execute, push, then andx-deploy with health checks (no review gate). Use for \"execute and deploy\"."
disable-model-invocation: true
effort: medium
---
# Andx Execute and Deploy

Alias of `/andx-execute --deploy`: follow [/andx-execute](../andx-execute/SKILL.md) with `--deploy` on the given plan.

Ledger: `node "$S/run.mjs" start --slug "$SLUG" --mode deploy`; phases `A` (worker pass), then `A′` (push), `B`, `C`, `D` per [/andx-deploy](../andx-deploy/SKILL.md), which it reads after cleanup evidence; it keeps the ship-queue lock until fresh health. `run.mjs end` prints the status line that ends the reply.
