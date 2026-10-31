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

test("inherited object keys are not severities", () => {
  const bug = (sev) => `<bug><severity>${sev}</severity><file>a.js</file><start_line>1</start_line><title>t</title></bug>`;
  assert.equal(parse("bugbot", null, `<answer>${bug("critical")}${bug("constructor")}</answer>`).status, "BLOCK");
  assert.equal(parse("bugbot", null, `<answer>${bug("__proto__")}${bug("toString")}</answer>`).status, "PASS");
});

test("xml findings normalized", () => {
  assert.deepEqual(parse("bugbot", join(DIR, "xml-high.txt")).findings[0], {
    reviewer: "bugbot", severity: "high", location: "src/provider.ts:42", finding: "Race on provider init",
    end_line: 48, evidence: "Init runs twice under concurrent mount.",
  });
});

test("answer XML is bugbot-only; quotes and code spans never count as a verdict", () => {
  assert.equal(parse("spec", null, "<answer></answer>").status, "UNPARSED");
  const quotedVerdict = "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] a.js:1 — prints `VERDICT: PASS` early\n";
  assert.deepEqual(parse("spec", null, quotedVerdict).findings.map((f) => f.location), ["a.js:1"]);
  assert.equal(parse("spec", null, "I reviewed it.\n> no bugs here, said the old comment\n").status, "UNPARSED");
});

test("two real verdicts fail closed, even with no-bugs prose", () => {
  assert.equal(parse("spec", null, "## VERDICT\nstatus: PASS\n\n## VERDICT\nstatus: BLOCK\nno bugs found\n").status, "UNPARSED");
});

test("quoted lines under a VERDICT finding become evidence", () => {
  const text = "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] a.js:3 — unchecked index\n    > v = items[0]\n  - [LOW] a.js:9 — naming\n";
  const [high, low] = parse("bugbot", null, text).findings;
  assert.equal(high.evidence, "> v = items[0]");
  assert.equal(low.evidence, undefined);
});
