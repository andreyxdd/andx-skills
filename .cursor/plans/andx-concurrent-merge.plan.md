---
name: Concurrent merge combo skill
overview: Orch concurrent-merge, slug worktrees in the parent Cursor workspace, and thin /andx-execute-review-and-deploy.
andx_ready: true
domain_grilled: skipped
design_pass: skipped
workstream: docs
pipeline_stage: 03-build
companion_skills: []
stack: none
source: thread
todos: []
isProject: false
---

# Concurrent merge + slug worktrees + review-and-deploy

**Sibling plan:** MR rename (`andx-pr-review` → `andx-mr-review`) — do not mix into this execute work.

SSOT: git + workspace + naming live in orch. Execute skills link; no bash paste.

**Same Cursor workspace:** parent stays `REPO_ROOT`; worker uses `WORKTREE_DIR` as tool cwd; forbid `move_agent_to_root` / `move_agent_to_cloned_root` to exec worktrees.

**Slug names:** `EXEC_BRANCH=andx/exec-${SLUG}-${STAMP}`; `WORKTREE_DIR=$REPO_ROOT/.worktrees/exec-${SLUG}-${STAMP}`.

**Concurrent-merge:** integrate TARGET into EXEC in the worktree; never leave TARGET conflicted (`git merge --abort`); parent never edits conflict markers.

## Execution steps

### step-1 — Orch naming, workspace, concurrent-merge
kind: docs
depends: []
touch: [andx-orchestration/SKILL.md, andx-orchestration/HARNESS.md]
success: slug EXEC_BRANCH/WORKTREE_DIR; Step 2 + HARNESS forbid move_agent_to_root to worktree; parent stays REPO_ROOT; Step 4 concurrent-merge
verification: grep -q 'exec-${SLUG}' andx-orchestration/SKILL.md && grep -q 'move_agent_to_root' andx-orchestration/SKILL.md && grep -q 'merge --abort' andx-orchestration/SKILL.md && ! grep -q 'move_agent_to_root.*WORKTREE' andx-orchestration/HARNESS.md

### step-2 — Point execute family at protocol
kind: docs
depends: [step-1]
touch: [andx-execute/SKILL.md, andx-execute-and-review/SKILL.md, andx-execute-and-deploy/SKILL.md, andx-debug-and-fix/SKILL.md, andx-deploy/SKILL.md, andx-schedule/SKILL.md]
success: Merge/workspace/slug link orch; execute-and-review Phase F re-review 1-3 after product-source conflict resolution; worker anti-pattern includes move_agent_to_root
verification: grep -q 'Step 4' andx-execute/SKILL.md && grep -q 'reviewers 1-3' andx-execute-and-review/SKILL.md

### step-3 — New combo skill + install
kind: docs
depends: [step-1]
touch: [andx-execute-review-and-deploy/, install.sh]
success: Thin A / A′ / B–D composer; install.sh lists it
verification: test -f andx-execute-review-and-deploy/SKILL.md && grep -q andx-execute-review-and-deploy install.sh

### step-4 — Map, plan Next, README
kind: docs
depends: [step-2, step-3]
touch: [andx-orchestration/SKILL-MAP.md, andx-orchestration/SKILL.md, andx-plan/SKILL.md, andx-plan/PLAN-FORMAT.md, README.md]
success: Combo in README + SKILL-MAP + plan Next/picker; README notes slug worktrees + same workspace (no worktree move_agent_to_root)
verification: grep -q andx-execute-review-and-deploy README.md && grep -q andx-execute-review-and-deploy andx-plan/SKILL.md && grep -q andx-execute-review-and-deploy andx-orchestration/SKILL-MAP.md

## Next

    Plan: .cursor/plans/andx-concurrent-merge.plan.md
    Next:
    - (default) /andx-execute
    - /andx-execute-and-review
    - /andx-execute-and-deploy
    - /andx-execute-review-and-deploy
    Reply go → run default on this plan.
