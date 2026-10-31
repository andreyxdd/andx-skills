#!/usr/bin/env node
// Per-reviewer catch counts across REVIEW-ARTIFACT files (andx-mr-review/FINDINGS-SCHEMA.md, v1 and v2).
//   node review-stats.mjs [--json] <dir|file...>   # dir = every *.json in it
// findings     non-rejected findings the reviewer raised
// unique       of those, findings no other reviewer raised
// high_unique  of those, confirmed (v1: no status) high or critical
// rejected     rejected findings the reviewer raised; never counted as catches
import fs from "node:fs";
import path from "node:path";

// "cursor security-review", "andx-spec-reviewer", "Ponytail-Review" -> security, spec, ponytail.
const ALIASES = { "ponytail-audit": "audit" };
export function canonical(name) {
  const n = String(name).trim().toLowerCase().replace(/^(cursor\s+|andx-)/, "").replace(/[-\s]review(er)?$/, "");
  return ALIASES[n] ?? n;
}

export function stats(artifacts) {
  const zero = () => ({ findings: 0, unique: 0, high_unique: 0, rejected: 0 });
  const reviewers = {}, total = zero();
  for (const f of artifacts.flatMap((a) => a.findings)) {
    const who = [...new Set((Array.isArray(f.reviewers) ? f.reviewers : []).map(canonical))];
    const rejected = f.status === "rejected";
    const unique = !rejected && who.length === 1;
    const high = unique && (f.status ?? "confirmed") === "confirmed" && /^(high|critical)$/i.test(f.severity ?? "");
    const add = (s) => { if (rejected) s.rejected++; else { s.findings++; s.unique += unique; s.high_unique += high; } };
    add(total);
    for (const r of who) add((reviewers[r] ??= zero()));
  }
  const sorted = Object.fromEntries(Object.keys(reviewers).sort().map((r) => [r, reviewers[r]]));
  return { files: artifacts.length, reviewers: sorted, total };
}

function load(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  if (!Array.isArray(j?.findings)) throw new Error(`${file}: not a REVIEW-ARTIFACT (no findings array)`);
  return j;
}

const files = (p) => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).filter((e) => e.endsWith(".json")).sort().map((e) => path.join(p, e))
  : [p];

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const inputs = args.filter((a) => a !== "--json");
  if (!inputs.length || args.includes("--help")) {
    console.error("usage: review-stats.mjs [--json] <dir|file...>");
    process.exit(args.includes("--help") ? 0 : 2);
  }
  let s;
  try {
    s = stats(inputs.flatMap(files).map(load));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const line = (c) => `findings=${c.findings} unique=${c.unique} high_unique=${c.high_unique} rejected=${c.rejected}`;
  if (json) console.log(JSON.stringify(s, null, 2));
  else {
    for (const [r, c] of Object.entries(s.reviewers)) console.log(`${r} ${line(c)}`);
    console.log(`total files=${s.files} ${line(s.total)}`);
  }
}
