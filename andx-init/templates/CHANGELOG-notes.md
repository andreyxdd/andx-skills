# Template gaps vs current andx practice

Inventory for OKF/ICM preset redesign (2026-08-10). Gaps below = missing or weak in templates before this pass.

| Gap | Why it matters | Target |
|-----|----------------|--------|
| **workstream stubs** | Plans require `workstream: code\|docs\|mixed`; drives TDD vs doc-verify in `/andx-execute` | IDENTITY (or knowledge) short stub per preset |
| **stack stubs** | Plans use `stack: react-next\|none`; sets `REACT_STACK` for companions | IDENTITY stub — app may hint React/Next; data/content stay `none` |
| **Next + go handoff** | After `/andx-plan`, agents must surface Next menu; bare `go` runs default skill | Slim AGENTS.md (create for data/content) |
| **Deploy rediscovery** | `/andx-deploy` re-reads repo docs + `.cursor/rules/*deploy*` every run — not cached in shared skills | AGENTS.md pointer |
| **HARNESS / SKILL-MAP** | Spawn matrix + companion routing live in andx-orchestration; scaffolds should not re-paste | Brief awareness link in AGENTS.md |
| **AGENTS.md slimness** | Entry point must stay short; long boilerplate competes with IDENTITY/ROUTING/knowledge | Keep AGENTS thin; put domain detail elsewhere |

Scaffold stays **additive** (never overwrite). Re-run safe on brownfield.
