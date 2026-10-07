# Refuter measurement

**Predeclared rule:** replay past security critical/high (N ≥ 10). Keep the refuter only if ≥ 10% flip to `rejected`/`needs_validation` and zero human-confirmed real findings are rejected; otherwise drop the refuter and keep the severity anchors.

## 2026-10-07 baseline: not decidable

- 151 artifacts scanned (`~/Dev/**/.cursor/reviews/*.json`); 5 critical/high findings attributed to the security reviewer, all in `vlt-3341-multichain-evm-*`, all `outcome: fixed` (human-accepted as real).
- N = 5 < 10. Replay also lacks fidelity: artifacts record the post-fix `head_sha`, so a refuter would see fixed code; transcripts do not keep reviewer tool output.

**Decision:** keep the refuter provisionally. Guard while unmeasured: every `rejected` critical/high is listed in the run's final reply (one line + reason) so a false rejection is visible to a human.

## Re-measure

v2 artifacts now record `status` and `reviewers`. When ≥ 10 security critical/high candidates have a refuter decision and a human outcome, count flips and false rejections, then apply the rule above (offer via `/retro`).
