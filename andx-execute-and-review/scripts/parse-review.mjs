#!/usr/bin/env node
// Normalize one reviewer's raw output into {status, findings[]}.
// Usage: node parse-review.mjs <reviewer-name> [file]   (stdin when no file)
// status: BLOCK (any critical/high) | FIX (medium only) | PASS | UNPARSED
// UNPARSED also: more than one real VERDICT; a Critical/High line with no VERDICT; bugbot XML with more
// than one <answer>, an unclosed one, a <bug> that did not parse, or an unknown severity.
// <answer> XML is read for bugbot only. "> " lines and `code` spans never count as a verdict, table or prose.
// evidence: Bugbot <description>, or "> " lines indented under a VERDICT finding.
import fs from "node:fs";

export const SEV = { __proto__: null, critical: 4, high: 3, medium: 2, low: 1, nitpick: 0 };
const UNPARSED = { status: "UNPARSED", findings: [] };

function statusFor(findings) {
  const top = Math.max(0, ...findings.map((f) => SEV[f.severity] ?? 0));
  return top >= 3 ? "BLOCK" : top === 2 ? "FIX" : "PASS";
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();
const withEvidence = (f, ev) => (ev ? { ...f, evidence: ev } : f);
const count = (text, s) => text.split(s).length - 1;

export function parse(text, reviewer) {
  // 1) Bugbot native XML: <answer></answer> = no bugs.
  if (reviewer === "bugbot" && (text.includes("<answer>") || text.includes("</answer>"))) {
    if (count(text, "<answer>") !== 1 || count(text, "</answer>") !== 1) return UNPARSED;
    const answer = text.match(/<answer>([\s\S]*?)<\/answer>/)?.[1];
    if (answer == null) return UNPARSED;
    const findings = [...answer.matchAll(/<bug>([\s\S]*?)<\/bug>/g)].map(([, bug]) => withEvidence({
      reviewer, severity: tag(bug, "severity").toLowerCase(),
      location: `${tag(bug, "file")}:${tag(bug, "start_line")}`, finding: tag(bug, "title"),
    }, tag(bug, "description")));
    if (count(answer, "<bug>") !== findings.length || findings.some((f) => !(f.severity in SEV))) return UNPARSED;
    return { status: statusFor(findings), findings };
  }

  // 2) VERDICT block; ignore echoed template placeholders.
  const unquoted = text.replace(/^[ \t]*>.*$/gm, "").replace(/`(PASS|BLOCK)`/gi, "$1");
  const plain = unquoted.replace(/`[^`\n]*`/g, "");
  const real = plain.replace(/(?:PASS|BLOCK)\s*\|\s*(?:PASS|BLOCK)/gi, "");
  const verdicts = [...real.matchAll(/VERDICT\W*(?:status:\s*)?[*_\s]*(PASS|BLOCK)(?![A-Za-z0-9])/gi)].map((m) => m[1]);
  if (verdicts.length > 1) return UNPARSED;
  const findings = [...text.matchAll(/^\s*-\s*\[(CRITICAL|HIGH|MEDIUM|LOW|NEEDS_VALIDATION)\]\s*(\S+)\s*[—-]\s*(.+)((?:\n[ \t]*>.*)*)/gim)].map(
    ([, sev, loc, msg, ev]) => withEvidence({ reviewer, severity: sev.toLowerCase(), location: loc, finding: msg.trim() }, ev.trim()));
  if (verdicts.length === 1) return { status: verdicts[0].toUpperCase() === "BLOCK" ? "BLOCK" : statusFor(findings), findings };
  if (findings.some((f) => SEV[f.severity] >= 3)) return UNPARSED;

  // 3) Severity table rows: | HIGH | `file:line` | finding |
  const rows = [...unquoted.matchAll(/^\|\s*\**(CRITICAL|HIGH|MEDIUM|LOW)\**\s*\|\s*`?([^|`]+?)`?\s*\|\s*(.+?)\s*\|\s*$/gim)];
  if (rows.length) {
    const findings = rows.map(([, s, l, f]) => ({ reviewer, severity: s.toLowerCase(), location: l.trim(), finding: f }));
    return { status: statusFor(findings), findings };
  }

  // 4) Plain "no bugs" prose.
  if (/no (high-confidence )?bugs|found no bugs|no issues found/i.test(plain)) return { status: "PASS", findings: [] };

  return UNPARSED;
}

if (import.meta.main) {
  const [reviewer = "reviewer", file] = process.argv.slice(2);
  console.log(JSON.stringify(parse(fs.readFileSync(file ?? 0, "utf8"), reviewer), null, 2));
}
