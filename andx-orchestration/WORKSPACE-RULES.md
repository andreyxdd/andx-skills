# Workspace rules

Product rules travel with each workspace, never with these skills. Before spawning workers or reviewers, resolve the workspace root (the repo, or a parent multi-repo map containing it):

- `agents/rules/README.md` present → load rules whose scope matches the `touch` paths (MR: changed paths). Plan/dev/execute rules go into the worker prompt; rules listed under review and `*-review-gates.md` go into reviewer `Custom Instructions` as gate titles, not full text.
- No `agents/rules/` but `.cursor/rules/*review*` stubs pointing at a markdown body → follow that body.
- A violated gate is a blocker at the severity its file defines (default medium). Nothing found → skip.
