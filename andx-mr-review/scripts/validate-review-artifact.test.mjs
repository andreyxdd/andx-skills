import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate-review-artifact.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const v1 = {
  schema_version: 1, source: "andx-execute-and-review", plan: ".cursor/plans/x.plan.md",
  target_branch: "main", head_sha: HEAD, reviewed_at: "2026-10-07T00:00:00Z", verdict: "PASS",
  findings: [{ id: "x", severity: "MEDIUM", location: "a.ts:1", finding: "f", status: "fixed" }],
};
const v2 = {
  ...v1, schema_version: 2, base_sha: BASE,
  findings: [
    { id: "sql-injection:getUser", severity: "high", status: "confirmed", resolution: "fixed", location: "a.ts:1", finding: "f" },
    { id: "xff-trust", status: "needs_validation", location: "b.ts:2", finding: "proxy" },
  ],
};

test("v1 is readable but never trusted for skipping", () => {
  const r = validate(v1, { head: HEAD, base: BASE });
  assert.deepEqual(r.errors, []);
  assert.equal(r.trusted, false);
});

test("v2 with matching head and base is trusted", () => {
  const r = validate(v2, { head: HEAD, base: BASE });
  assert.deepEqual(r.errors, []);
  assert.equal(r.trusted, true);
});

test("unknown schema version is rejected", () => {
  assert.match(validate({ ...v2, schema_version: 3 }).errors[0], /unknown schema_version/);
});

test("tampered base is not trusted", () => {
  const r = validate({ ...v2, base_sha: "c".repeat(40) }, { head: HEAD, base: BASE });
  assert.equal(r.trusted, false);
  assert.match(r.mismatch.join(), /base_sha/);
});

test("PASS with an unfixed confirmed high is invalid", () => {
  const bad = { ...v2, findings: [{ ...v2.findings[0], resolution: undefined }] };
  assert.match(validate(bad).errors.join(), /PASS with unfixed high/);
});

test("needs_validation must not carry severity", () => {
  const bad = { ...v2, findings: [{ ...v2.findings[1], severity: "high" }] };
  assert.match(validate(bad).errors.join(), /must not carry severity/);
});
