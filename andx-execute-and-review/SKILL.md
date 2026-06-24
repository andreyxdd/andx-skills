---
name: andx-execute-and-review
description: Executes an approved plan in an isolated worktree, then gates the merge behind independent adversarial review (code-quality + Karpathy compliance always, ponytail over-engineering review always, security, React perf, and scoped bloat audit conditional). The worker fixes blocking findings in a bounded loop before the branch merges to the checked-out target branch. Use for /andx-execute-and-review or "execute and review".
---

# Andx Execute and Review

Implement via a subagent in an isolated worktree, then **gate the merge behind independent review**. Nothing unreviewed reaches `TARGET_BRANCH`. The same worker fixes blocking findings; review and fix loop until clean or escalation.

**Primary tool:** Cursor. Plans live at `<repo>/.cursor/plans/*.plan.md`. Use `move_agent_to_root` when workspace ≠ target repo.

## When to use

- User invokes `/andx-execute-and-review` or asks to execute a plan **with a review gate** before merge
- A plan is ready at `.cursor/plans/*.plan.md` (or supplied in the same thread)
- The change warrants an independent second pass before it lands

**Not for:** deploy (use `/andx-execute-and-deploy`), or execution without a review gate (use `/andx-execute`).

## Required companion skills

| Skill | Role |
|-------|------|
| [/andx-orchestration](../andx-orchestration/SKILL.md) | Worktree isolation, spawn, merge-back (parent) |
| [/andx-execute](../andx-execute/SKILL.md) | Worker Phases 0–4 (subagent) |
| [/review](../review/SKILL.md) | Code-quality reviewer (Cursor) |
| [/security-review](../security-review/SKILL.md) | Security reviewer when conditional gate applies |
| `~/.cursor/skills-cursor/ponytail-review/SKILL.md` | Over-engineering diff review (always) |
| `~/.cursor/skills-cursor/ponytail-audit/SKILL.md` | Scoped bloat audit when diff adds deps/files (conditional) |
| `~/.cursor/skills/react-best-practices/SKILL.md` | React perf reviewer when diff touches React paths (conditional) |
| `fresh verification output in the current message before completion claims` | Evidence before claims (parent) |
| `/tdd` | Test-first (subagent) |

## Core principle

The reviewer must be **blind to the author's reasoning** — fresh agent, no shared context, given only the diff + plan + verification table. Independence is the whole point; a reviewer that shares the worker's rationalizations rubber-stamps. The worker then fixes, because *it* holds the implementation context.

## Workflow overview

```
A. Parent: /andx-execute Orchestrator preflight → spawn worker (worktree)
B. Worker: Phases 0–4 → commit on EXEC_BRANCH → handoff
C. Parent: spawn parallel REVIEWERS (fresh agents, adversarial)
D. Parent: merge verdicts → BLOCK if any blocks
E. Blockers → resume worker subagent to fix → re-run Phase 3 → re-review (changed + prior)
   (max 3 rounds; else escalate to user — no merge)
F. Clean → parent merge → post-merge Phase 3 → cleanup
```

---

## Phase A–B — Execute

Follow [/andx-execute](../andx-execute/SKILL.md) **§ Orchestrator** preflight and worker spawn. The worker runs **§ Worker** Phases 0–4 and returns the handoff schema (status, EXEC_BRANCH, commit range, verification table, Phase 3 evidence).

The worker inherits ponytail over-engineering discipline from the global always-on rule during implementation — prefer deletion, stdlib, and native platform features over new deps and abstractions.

Do **not** merge yet. On worker `pass`, proceed to review. On worker `fail`, report blockers; do not review a failing branch.

---

## Phase C — Independent review (parallel fresh agents)

Spawn reviewers as **fresh `Task` subagents** (new spawns, not the worker; no shared context). Apply per reviewer:

- **Read-only** — reviewers judge; they do not edit application source.
- **Adversarial framing** — "Find what's wrong. Default to requesting changes. Justify any pass."
- Give them: `git diff TARGET_BRANCH..EXEC_BRANCH`, the plan (with `touch` scope + step `success`/`verification`), and the worker's verification evidence.

Run reviewers **in parallel**:

### Reviewer 1 — Code quality + Karpathy compliance (ALWAYS)

Invoke [/review](../review/SKILL.md) on the diff, then **re-express as a VERDICT block** and layer Karpathy checks:

| Karpathy rule | Check | Severity |
|---------------|-------|----------|
| **3. Surgical changes** | Every changed file/line within the plan's `touch` scope. Out-of-scope edits = violation. | **HIGH → BLOCKS** |
| **2. Simplicity** | Speculative abstraction, unused config/flexibility, needless indirection. | **MEDIUM → fix-or-justify** |
| **4. Verification** | Enforced upstream via worker Phase 3 — not re-judged here. | (upstream) |

Rule 1 (state assumptions) belongs in `/andx-plan` / `/grill-me`, not in diff review.

### Reviewer 2 — Security (CONDITIONAL)

Run **only** when the diff touches: auth/authorization/session, user input → DB/filesystem/shell, new external surfaces, secrets/crypto, or LLM features (prompt, tools, RAG, model output → sink).

Invoke [/security-review](../security-review/SKILL.md) on the diff.

### Reviewer 3 — Over-engineering (ALWAYS)

Invoke `~/.cursor/skills-cursor/ponytail-review/SKILL.md` on the diff. Map ponytail tags to severity in the VERDICT block:

| Ponytail tag | Condition | Severity |
|--------------|-----------|----------|
| `native:` / `stdlib:` | **New dependency** introduced by the diff | **HIGH → BLOCKS** |
| `yagni:` / `delete:` / `native:` / `stdlib:` | Other findings (no new dep) | **MEDIUM → fix-or-justify** |
| `shrink:` | Same logic, fewer lines | **LOW → advisory** |

End with ponytail's `net: -<N> lines possible.` metric in the review output; fold blockers/advisories into VERDICT.

### Reviewer 4 — Scoped bloat audit (CONDITIONAL)

Run **only** when the diff **adds dependencies** (package manifest, lockfile, or import of a new external module) **or adds new files** under the plan's `touch` prefixes.

Invoke `~/.cursor/skills-cursor/ponytail-audit/SKILL.md`, but **scope the audit to plan `touch` prefixes only** — do not scan the whole repo. Rank findings within that scope; map tags to the same severity table as Reviewer 3.

### Reviewer 5 — React performance (CONDITIONAL)

Run **only** when the diff touches `.tsx`/`.jsx` files or paths under `app/`, `pages/`, or `components/`.

Read `~/.cursor/skills/react-best-practices/SKILL.md`. Check the diff against priority 1–3 rule categories (`async-`, `bundle-`, `server-`). Map findings to VERDICT:

| Finding | Severity |
|---------|----------|
| Waterfall fetch, barrel import, RSC over-serialization | **HIGH → BLOCKS** |
| Re-render/rendering issues with measurable perf risk | **MEDIUM → fix-or-justify** |
| LOW `js-` optimizations | **LOW → advisory** |

### Verdict contract (all reviewers)

```
## VERDICT
status: BLOCK | PASS
blockers:
  - [CRITICAL|HIGH] <file:line> — <one line>
advisory:
  - [MEDIUM|LOW] <file:line> — <one line>
```

`status: BLOCK` iff ≥1 Critical/High finding.

---

## Phase D — Merge verdicts

- **BLOCK if any reviewer blocks (Reviewers 1–5).** Union of all blocker lines.
- Medium findings → worker must **fix or justify-and-defer** with a logged reason.
- Low/advisory → logged, never block.

If all reviewers `PASS` and no unresolved Medium → go to Phase F.

### Fail-safe parse rule

Missing or malformed VERDICT → treat as **`BLOCK`**. Re-request once; if still malformed, escalate to user.

---

## Phase E — Fix loop (bounded)

For each round (max **3**):

1. **Resume the same worker** (`Task` with `resume=<agent_id>`) with the union blocker list + unresolved Mediums. If resume unavailable, spawn a new worker pointed at `WORKTREE_DIR` with the fix list — branch + commits persist on disk.
2. Worker fixes — surgical, scoped to findings.
3. Worker **re-runs Phase 3** on `EXEC_BRANCH` and re-commits.
4. Re-review: **always re-run Reviewers 1 and 3**; re-run Reviewers 2, 4, and 5 when their conditional gates still apply. Scope to changed lines + previously-flagged items only.
5. Clean → Phase F.

After **3 rounds** still blocked → **escalate to user**. **Do not merge.**

---

## Phase F — Merge & finalize

Per [/andx-orchestration](../andx-orchestration/SKILL.md) Step 4:

1. `git checkout TARGET_BRANCH && git merge EXEC_BRANCH`
2. **Post-merge Phase 3** on `TARGET_BRANCH`
3. Show fresh verification output before completion language
4. Mandatory worktree cleanup with evidence

## Definition of done

- Worker handoff `pass`; verification table green on EXEC_BRANCH
- All reviewer verdicts `PASS` (Reviewers 1 and 3 always; 2, 4, and 5 when conditional gates applied); zero unresolved blockers
- Ponytail reviewers report no HIGH blockers; MEDIUMs fixed or justified
- `EXEC_BRANCH` merged into `TARGET_BRANCH`; post-merge Phase 3 green
- Worktree removed and branch deleted with logged evidence

## Progress tracking

```
Execute + Review (plan: .cursor/plans/x.plan.md; target: main):
- [x] Worker handoff — pass
- [x] Review round 1 — code-quality BLOCK, ponytail BLOCK (new dep), security PASS
- [x] Worker fix round 1 → Phase 3 re-run green
- [x] Review round 2 — code-quality PASS, ponytail PASS, scoped audit PASS
- [x] Merged to main — post-merge Phase 3 passed
- [x] Worktree cleaned
```

## Anti-patterns

- Reviewer sharing the worker's context
- Merging with open Critical/High findings
- Unbounded review loop (no escalation after 3 rounds)
- Parent editing source to "just fix" instead of routing to worker
- Planning from home — use `move_agent_to_root` first
- Running Reviewer 4 as a whole-repo audit instead of scoping to plan `touch` prefixes
- Treating ponytail `shrink:` (LOW) as a merge blocker

## Optional pairing

| Situation | Skill |
|-----------|--------|
| Execute without review gate | `/andx-execute` |
| Execute + deploy | `/andx-execute-and-deploy` |
| Plan missing depends/touch/verification | `/andx-plan` |
| Deep security pass standalone | `/security-review` |
| Over-engineering diff review standalone | `/ponytail-review` |
| React/Next perf review standalone | `/react-best-practices` |
| Scoped or repo-wide bloat audit standalone | `/ponytail-audit` |
