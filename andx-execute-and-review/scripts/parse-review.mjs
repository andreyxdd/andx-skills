#!/usr/bin/env node
// Normalize one reviewer's raw output into {status, findings[]}.
// Usage: node parse-review.mjs <reviewer-name> [file]   (stdin when no file)
// Preferred input: a JSON report {"status":"PASS|BLOCK","findings":[{"severity","location","finding","evidence"?}]};
// extra top-level keys are ignored and "info" reads as nitpick; file+line, title/issue/detail fold into
// location/finding and fix/wcag/rule/plan/id are dropped; any other shape, extra finding key or unknown
// severity in JSON is UNPARSED. Prose around exactly one valid JSON report is tolerated. Text reports below stay supported.
// status: BLOCK (VERDICT says BLOCK, or any critical/high incl. table rows) | FIX (medium only) | PASS | UNPARSED
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

const JSON_SEV = ["critical", "high", "medium", "low", "nitpick", "needs_validation"];
const str = (v) => typeof v === "string" && v.trim() !== "";
const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

// Reviewers drift to file+line, title/issue/detail and side keys; fold those into the four canonical keys.
// Any other key (e.g. `reviewer`) survives the fold, so the schema check still fails closed on it.
const SIDE = ["fix", "wcag", "rule", "plan", "id"];
function canonical(f) {
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const { file, line, title, issue, detail, ...rest } = f;
  for (const k of SIDE) delete rest[k];
  const location = rest.location ?? (str(file) ? (line == null ? file : `${file}:${line}`) : undefined);
  const finding = rest.finding ?? ([title, issue ?? detail].filter(str).join(": ") || undefined);
  return { ...rest, ...(location !== undefined && { location }), ...(finding !== undefined && { finding }) };
}

export function parseJson(text, reviewer) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return UNPARSED;
  }
  // Extra top-level keys are reviewer metadata (passed checks, notes): ignored. Extra finding keys could spoof `reviewer`: fail closed.
  if (!r || typeof r !== "object" || Array.isArray(r)) return UNPARSED;
  if (!["PASS", "BLOCK"].includes(r.status) || !Array.isArray(r.findings)) return UNPARSED;
  const all = r.findings.map(canonical);
  const ok = (f) => f && only(f, ["severity", "location", "finding", "evidence"])
    && (JSON_SEV.includes(f.severity) || f.severity === "info") && str(f.location) && str(f.finding) && (f.evidence === undefined || str(f.evidence));
  if (!all.every(ok)) return UNPARSED;
  const findings = all.map((f) => ({ reviewer, ...f, ...(f.severity === "info" && { severity: "nitpick" }) }));
  return { status: r.status === "BLOCK" ? "BLOCK" : statusFor(findings), findings };
}

// Balanced top-level objects starting with {"status" anywhere in the text (string-aware).
function reportObjects(text) {
  const out = [];
  for (let i = text.indexOf('{"status"'); i >= 0; i = text.indexOf('{"status"', i + 1)) {
    let depth = 0, quoted = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (quoted) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; }
    }
  }
  return out;
}

export function parse(text, reviewer) {
  // One ```json fence around the whole reply is tolerated.
  const bare = text.trim().replace(/^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/, "$1");
  if (bare.startsWith("{")) {
    const r = parseJson(bare, reviewer);
    if (r.status !== "UNPARSED" || reportObjects(bare).length !== 1 || reportObjects(bare)[0] === bare) return r;
  }
  // Prose around exactly one valid JSON report: the report wins. Zero or several fall through to the text formats.
  const objs = reportObjects(text);
  if (objs.length === 1) {
    const r = parseJson(objs[0], reviewer);
    if (r.status !== "UNPARSED") return r;
  }
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
  const verdicts = [...real.matchAll(/VERDICT\W*(?:status\s*:?\s*)?[*_\s]*(PASS|BLOCK)(?![A-Za-z0-9])/gi)].map((m) => m[1]);
  if (verdicts.length > 1) return UNPARSED;
  const findings = [...text.matchAll(/^\s*-\s*\[(CRITICAL|HIGH|MEDIUM|LOW|NEEDS_VALIDATION)\]\s*(\S+)\s*[—-]\s*(.+)((?:\n[ \t]*>.*)*)/gim)].map(
    ([, sev, loc, msg, ev]) => withEvidence({ reviewer, severity: sev.toLowerCase(), location: loc, finding: msg.trim() }, ev.trim()));
  // 3) Severity table rows: | HIGH | `file:line` | finding |
  const rows = [...unquoted.matchAll(/^\|\s*\**(CRITICAL|HIGH|MEDIUM|LOW)\**\s*\|\s*`?([^|`]+?)`?\s*\|\s*(.+?)\s*\|\s*$/gim)]
    .map(([, s, l, f]) => ({ reviewer, severity: s.toLowerCase(), location: l.trim(), finding: f }));
  if (verdicts.length === 1) {
    const all = [...findings, ...rows];
    return { status: verdicts[0].toUpperCase() === "BLOCK" ? "BLOCK" : statusFor(all), findings: all };
  }
  if (findings.some((f) => SEV[f.severity] >= 3)) return UNPARSED;
  if (rows.length) return { status: statusFor(rows), findings: rows };

  // 4) Plain "no bugs" prose.
  if (/no (high-confidence )?bugs|found no bugs|no issues found/i.test(plain)) return { status: "PASS", findings: [] };

  return UNPARSED;
}

if (import.meta.main) {
  const [reviewer = "reviewer", file] = process.argv.slice(2);
  console.log(JSON.stringify(parse(fs.readFileSync(file ?? 0, "utf8"), reviewer), null, 2));
}
