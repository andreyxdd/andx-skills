# Refuter measurement

**Predeclared rule:** replay past security critical/high (N ≥ 10). Keep the refuter only if ≥ 10% flip to `rejected`/`needs_validation` and zero human-confirmed real findings are rejected; otherwise drop the refuter and keep the severity anchors.

## 2026-10-07 baseline: not decidable

- 151 artifacts scanned (`~/Dev/**/.cursor/reviews/*.json`); 5 critical/high findings attributed to the security reviewer, all in `vlt-3341-multichain-evm-*`, all `outcome: fixed` (human-accepted as real).
- N = 5 < 10. Replay also lacks fidelity: artifacts record the post-fix `head_sha`, so a refuter would see fixed code; transcripts do not keep reviewer tool output.

**Decision:** keep the refuter provisionally. Guard while unmeasured: every `rejected` critical/high is listed in the run's final reply (one line + reason) so a false rejection is visible to a human.

## Re-measure

v2 artifacts now record `status` and `reviewers`. When ≥ 10 security critical/high candidates have a refuter decision and a human outcome, count flips and false rejections, then apply the rule above (offer via `/retro`).

## 2026-11-16 LFD121 rules replay

Rules: R1 fail-open guard branch, R2 client-side/obscurity, R3 fewer independent conditions, R4 suppressions/deleted deny tests/mock evidence, R5 variant search, R6 stored vs request copy, R7 missing audit record, R8 validator defects, R9 Go sinks, R10 outbound TLS, R11 crypto deny-list, R12 approval-screen Unicode, R13 false-positive filters, R14 scanner prepass and new-dependency check.

Gate mode, 5 merged diffs, scanners `NOT_RUN`. **Deviation:** no pre-fix commits exist (fixes were folded into feature commits), so all replays ran on post-fix code: recall is unmeasured; noise and re-flagging are measured.

| Case | Verdict | New from R1–R14 |
|------|---------|-----------------|
| Go wallet MR, 1 confirmed high | PASS | 1 LOW: R5 found a real unfixed sibling panic |
| C# indexer MR, 3 confirmed highs | PASS | 1 LOW (R5, admin-only); 2 needs_validation (R10, R1) |
| TypeScript mobile MR, 1 confirmed high | PASS | none |
| Go wallet MR, clean control | BLOCK | 1 HIGH (R1 with a newer workspace gate): error served as partial 200; a human confirmed it later. 1 MEDIUM (R5) |
| C# indexer MR, clean control | PASS | none |

No confirmed fix was re-flagged. Blocker/high with no human-confirmed issue: 0, so no rule is downgraded. R13 and the candidate gate dropped 32 candidates, checked only by the reviewers' own reasoning.

**Caveats:** N = 5; post-fix code; R14 untested.

**Next:** replay at the pre-fix head of the next real security finding.
