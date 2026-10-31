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

const bug = (sev) => `<bug><severity>${sev}</severity><file>a.js</file><start_line>1</start_line><title>t</title></bug>`;

test("inherited object keys and unknown severities fail closed", () => {
  assert.equal(parse("bugbot", null, `<answer>${bug("critical")}${bug("constructor")}</answer>`).status, "UNPARSED");
  assert.equal(parse("bugbot", null, `<answer>${bug("__proto__")}${bug("toString")}</answer>`).status, "UNPARSED");
  assert.equal(parse("bugbot", null, `<answer>${bug("info")}</answer>`).status, "UNPARSED");
});

test("truncated or repeated bugbot XML fails closed", () => {
  assert.equal(parse("bugbot", null, `<answer>${bug("low")}<bug><title>cut off</answer>`).status, "UNPARSED");
  assert.equal(parse("bugbot", null, `<answer></answer><answer>${bug("high")}</answer>`).status, "UNPARSED");
  assert.equal(parse("bugbot", null, `<answer>${bug("high")}`).status, "UNPARSED");
});

test("a Critical/High line without a verdict is UNPARSED, never prose PASS", () => {
  assert.equal(parse("spec", null, "I looked.\n- [HIGH] a.js:1 — bug\nno bugs found\n").status, "UNPARSED");
});

test("a PASS verdict does not hide table or bullet findings", () => {
  const table = "## VERDICT\nstatus: PASS\n\n| Severity | Location | Finding |\n|---|---|---|\n| HIGH | `a.js:1` | bad |\n";
  const r = parse("spec", null, table);
  assert.deepEqual([r.status, r.findings.map((f) => [f.severity, f.location])], ["BLOCK", [["high", "a.js:1"]]]);
  const both = parse("spec", null, `${table}advisory:\n  - [MEDIUM] b.js:2 — meh\n`);
  assert.deepEqual(both.findings.map((f) => f.location).sort(), ["a.js:1", "b.js:2"]);
});

test("status wrapped in backticks or underscores still counts", () => {
  assert.equal(parse("spec", null, "## VERDICT\nstatus: `BLOCK`\nblockers:\n  - [MEDIUM] a.js:1 — x\n").status, "BLOCK");
  assert.equal(parse("spec", null, "## VERDICT\nstatus: _PASS_\n").status, "PASS");
});

test("xml findings normalized", () => {
  assert.deepEqual(parse("bugbot", join(DIR, "xml-high.txt")).findings[0], {
    reviewer: "bugbot", severity: "high", location: "src/provider.ts:42", finding: "Race on provider init",
    evidence: "Init runs twice under concurrent mount.",
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
