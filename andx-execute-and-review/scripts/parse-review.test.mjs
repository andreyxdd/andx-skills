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

test("real reports that used the prompt's own `## VERDICT: status X` line parse", () => {
  const REPORTS = join(here, "..", "fixtures", "reports");
  const block = parse("bugbot", join(REPORTS, "bugbot-status-no-colon-block.txt"));
  assert.deepEqual([block.status, block.findings.map((f) => f.severity)], ["BLOCK", ["high"]]);
  const pass = parse("spec", join(REPORTS, "spec-prose-status-no-colon-pass.txt"));
  assert.deepEqual([pass.status, pass.findings.map((f) => f.severity)], ["FIX", ["medium", "medium", "medium", "low", "low"]]);
  const json = parse("security", join(REPORTS, "security-json-pass.json"));
  assert.deepEqual([json.status, json.findings[0]], ["FIX", {
    reviewer: "security", severity: "medium", location: "bot/options.py:168",
    finding: "compressed response expansion occurs before the byte-limit check (remote-options-unbounded-response-body)",
  }]);
});

test("JSON reports are schema-checked and fail closed", () => {
  const f = { severity: "high", location: "a.js:1", finding: "bug" };
  assert.equal(parse("spec", null, JSON.stringify({ status: "PASS", findings: [f] })).status, "BLOCK");
  assert.equal(parse("spec", null, JSON.stringify({ status: "BLOCK", findings: [] })).status, "BLOCK");
  assert.equal(parse("spec", null, JSON.stringify({ status: "PASS", findings: [] })).status, "PASS");
  assert.equal(parse("spec", null, `\`\`\`json\n${JSON.stringify({ status: "PASS", findings: [f] })}\n\`\`\`\n`).status, "BLOCK");
  for (const bad of [
    "{not json",
    JSON.stringify({ status: "pass", findings: [] }),
    JSON.stringify({ status: "PASS" }),
    JSON.stringify({ status: "PASS", findings: [{ ...f, severity: "bogus" }] }),
    JSON.stringify({ status: "PASS", findings: [{ ...f, location: "" }] }),
    JSON.stringify({ status: "PASS", findings: [{ ...f, reviewer: "spoof" }] }),
  ]) assert.equal(parse("spec", null, bad).status, "UNPARSED", bad);
});

test("one JSON report amid prose parses; two reports or a broken one fall through", () => {
  const f = { severity: "high", location: "a.js:1", finding: "a } brace \" quote" };
  const one = JSON.stringify({ status: "BLOCK", findings: [f] });
  for (const text of [`Round 2 checked.\n${one}`, `${one}\n\nNext I'm checking the bar logic.`, `Lead-in:\n\`\`\`json\n${one}\n\`\`\`\nTrailing note.`]) {
    const r = parse("ux-api", null, text);
    assert.equal(r.status, "BLOCK", text);
    assert.deepEqual(r.findings.map((x) => x.finding), [f.finding]);
  }
  const pass = JSON.stringify({ status: "PASS", findings: [] });
  assert.equal(parse("react", null, `${pass}\n${pass}`).status, "UNPARSED");
  assert.equal(parse("react", null, `note ${JSON.stringify({ status: "PASS", findings: [{ ...f, reviewer: "spoof" }] })}`).status, "UNPARSED");
});

test("file+line, title/issue and side keys fold into the canonical finding", () => {
  const drift = { severity: "high", file: "a.tsx", line: 157, wcag: "2.4.3", title: "Focus lost", detail: "button unmounts", evidence: "> x" };
  const r = parse("a11y", null, JSON.stringify({ status: "BLOCK", findings: [drift, { severity: "low", file: "b.go", issue: "slow", fix: "cache", plan: "step-6" }] }));
  assert.deepEqual(r.findings.map((f) => [f.location, f.finding]), [["a.tsx:157", "Focus lost: button unmounts"], ["b.go", "slow"]]);
  assert.equal(parse("a11y", null, JSON.stringify({ status: "PASS", findings: [{ severity: "low", file: "b.go", issue: "x", reviewer: "spoof" }] })).status, "UNPARSED");
});

test("top-level metadata is ignored and info reads as nitpick", () => {
  const f = { severity: "info", location: "a.js:1", finding: "cleared prior blocker" };
  const r = parse("a11y", null, JSON.stringify({ status: "PASS", findings: [f], passed: ["lang"], notes: "x" }));
  assert.deepEqual([r.status, r.findings.map((x) => x.severity)], ["PASS", ["nitpick"]]);
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
