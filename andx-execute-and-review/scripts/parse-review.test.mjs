import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "..", "fixtures", "bugbot");

function parse(reviewer, file, input) {
  const r = spawnSync(process.execPath, [join(here, "parse-review.mjs"), reviewer, ...(file ? [file] : [])], { encoding: "utf8", input });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("every fixture classifies", () => {
  const expected = {
    "xml-no-bugs.txt": "PASS",
    "xml-high.txt": "BLOCK",
    "verdict-bold-pass.txt": "PASS",
    "verdict-heading-block.txt": "BLOCK",
    "template-echo-table.txt": "BLOCK",
    "verdict-status-pass.txt": "PASS",
    "prose-no-bugs.txt": "PASS",
    "unparsed.txt": "UNPARSED",
    "table-medium.txt": "FIX",
  };
  for (const [file, want] of Object.entries(expected)) assert.equal(parse("bugbot", join(DIR, file)).status, want, file);
});

test("security needs_validation is kept but not blocking (stdin)", () => {
  const text = "## VERDICT\nstatus: PASS\nsecrets_scan: NOT_RUN\nadvisory:\n  - [NEEDS_VALIDATION] b.js:2 — proxy trust (xff-trust)\n";
  const r = parse("security", null, text);
  assert.equal(r.status, "PASS");
  assert.equal(r.findings[0].severity, "needs_validation");
});

test("xml findings normalized", () => {
  assert.deepEqual(parse("bugbot", join(DIR, "xml-high.txt")).findings[0], {
    reviewer: "bugbot", severity: "high", location: "src/provider.ts:42", finding: "Race on provider init",
  });
});
