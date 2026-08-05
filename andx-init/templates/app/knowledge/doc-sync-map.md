---
type: reference
topic: doc-sync
---

# Doc sync map

Code path → doc targets for agents. Read this **before** updating docs after code changes.

## Doc tiers (do not duplicate)

| Tier | Path | Content |
|------|------|---------|
| ADR | `docs/adr/` | Why — irreversible product decisions |
| Feature | `docs/features/` | Implementation, API contracts |
| Diagram | `docs/diagrams/` | Layer/data-flow architecture |
| Runbook | `knowledge/runbooks/scenarios/` | URLs + UI clicks only |
| Ops | `knowledge/runbooks/local-dev.md` | Route table, dev setup |

Append one line to [log.md](log.md) when the knowledge bundle changes materially.

## Trigger map

| Code change in | Update |
| -------------- | ------ |
| `src/routes/` | [local-dev.md](runbooks/local-dev.md) (route table), affected [scenarios/*.md](runbooks/scenarios/) |
| Irreversible product decision | New/updated `docs/adr/*.md` |
| (add rows as features land) | |
