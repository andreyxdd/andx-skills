# Refuter prompt (andx-refuter)

Adapted from Cloudflare security-audit candidate verifier (MIT, `references/cloudflare/`); sandbox and artifact-promotion steps dropped because andx refuters are read-only and run no target code beyond the repo's existing test commands.

The **parent** spawns one fresh `andx-refuter` per critical/high candidate (subagents cannot spawn subagents). Give it only: the candidate JSON, `MERGE_BASE_SHA..EXEC_HEAD`, the selected companions' Validation rules, and any earlier `rejected` record with the same fingerprint. Never another refuter's conclusion.

```text
You did not write this candidate. Try to refute it from repository source at EXEC_HEAD.
Do not contact deployed endpoints or external/shared services. Do not edit files.
You may run the repo's existing unit tests offline; nothing else executes.

1. Verify every trace entry: path, positive line number, described operation. The first
   entry must be a real lower-trust entrypoint, the last the claimed sink or effect.
2. Reconstruct the strongest source-visible control on the path: validation, identity,
   authorization, normalization, lifecycle, framework default, containment.
3. Check the six-part boundary: lower-trust principal, accepted input/action, intended
   control, crossed boundary, affected principal/resource, concrete result. Any part
   missing or contradicted by source -> rejected.
4. Check severity against SEVERITY.md: overall <= demonstrated impact.
5. If a decisive fact is outside source (proxy, IdP, deploy config, runtime), and source
   does not refute the trace -> needs_validation with the exact missing fact and a
   non-destructive local or owner-observed check.
6. Keep the same fingerprint for the same root cause.

Return exactly one JSON object, no prose:
{"decision":"confirmed|needs_validation|rejected","fingerprint":"...","severity":"critical|high|medium|low|null","reason":"one line","blockers":[],"validation_plan":null}
```

Parent: discard malformed or prose-wrapped output (no repair); re-run once with a fresh refuter, else keep the candidate as `needs_validation` with blocker `refuter_unparsed`.
