#!/usr/bin/env node
// Normalize one reviewer's raw output into {status, findings[]}.
// Usage: node parse-review.mjs <reviewer-name> [file]   (stdin when no file)
// status: BLOCK (any critical/high) | FIX (medium only) | PASS | UNPARSED
import fs from "node:fs";

const SEV = { critical: 4, high: 3, medium: 2, low: 1, nitpick: 0 };

function statusFor(findings) {
  const top = Math.max(0, ...findings.map((f) => SEV[f.severity] ?? 0));
  return top >= 3 ? "BLOCK" : top === 2 ? "FIX" : "PASS";
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();

function parse(text, reviewer) {
  // 1) Bugbot native XML: <answer></answer> = no bugs.
  const answer = text.match(/<answer>([\s\S]*?)<\/answer>/)?.[1];
  if (answer != null) {
    const findings = [...answer.matchAll(/<bug>([\s\S]*?)<\/bug>/g)].map(([, bug]) => ({
      reviewer, severity: tag(bug, "severity").toLowerCase(),
      location: `${tag(bug, "file")}:${tag(bug, "start_line")}`, finding: tag(bug, "title"),
    }));
    return { status: statusFor(findings), findings };
  }

  // 2) VERDICT block; ignore echoed template placeholders.
  const real = text.replace(/(?:PASS|BLOCK)\s*\|\s*(?:PASS|BLOCK)/gi, "");
  const verdicts = [...real.matchAll(/VERDICT\W*(?:status:\s*)?\**\s*(PASS|BLOCK)\b/gi)].map((m) => m[1]);
  if (verdicts.length === 1) {
    const findings = [...text.matchAll(/^\s*-\s*\[(CRITICAL|HIGH|MEDIUM|LOW|NEEDS_VALIDATION)\]\s*(\S+)\s*[—-]\s*(.+)$/gim)].map(
      ([, sev, loc, msg]) => ({ reviewer, severity: sev.toLowerCase(), location: loc, finding: msg.trim() }));
    return { status: verdicts[0].toUpperCase() === "BLOCK" ? "BLOCK" : statusFor(findings), findings };
  }

  // 3) Severity table rows: | HIGH | `file:line` | finding |
  const rows = [...text.matchAll(/^\|\s*\**(CRITICAL|HIGH|MEDIUM|LOW)\**\s*\|\s*`?([^|`]+?)`?\s*\|\s*(.+?)\s*\|\s*$/gim)];
  if (rows.length) {
    const findings = rows.map(([, s, l, f]) => ({ reviewer, severity: s.toLowerCase(), location: l.trim(), finding: f }));
    return { status: statusFor(findings), findings };
  }

  // 4) Plain "no bugs" prose.
  if (/no (high-confidence )?bugs|found no bugs|no issues found/i.test(text)) return { status: "PASS", findings: [] };

  return { status: "UNPARSED", findings: [] };
}

const [reviewer = "reviewer", file] = process.argv.slice(2);
console.log(JSON.stringify(parse(fs.readFileSync(file ?? 0, "utf8"), reviewer), null, 2));
