#!/usr/bin/env node
// Validate a REVIEW-ARTIFACT and decide whether mr-review may skip its reviewers.
//   node validate-review-artifact.mjs <artifact.json> [--head SHA] [--base SHA]
// Prints READABLE | TRUSTED, or INVALID with reasons (exit 1). TRUSTED requires v2 + matching head and base.
import { readFileSync, statSync } from "node:fs";

const SOURCES = new Set(["andx-execute-and-review", "andx-mr-review", "andx-security-review"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low", "nitpick"]);
const STATUSES = new Set(["confirmed", "needs_validation", "rejected"]);
const RESOLUTIONS = new Set(["fixed", "deferred", "accepted"]);
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

const str = (v) => typeof v === "string" && v.trim() !== "";

export function validate(a, { head, base } = {}) {
  const errors = [];
  if (!a || typeof a !== "object" || Array.isArray(a)) return { errors: ["artifact is not an object"], trusted: false };
  const v = a.schema_version;
  if (v !== 1 && v !== 2) return { errors: [`unknown schema_version ${JSON.stringify(v)}`], trusted: false };
  if (!SOURCES.has(a.source)) errors.push(`unknown source ${JSON.stringify(a.source)}`);
  for (const k of ["plan", "target_branch", "reviewed_at"]) if (!str(a[k])) errors.push(`missing ${k}`);
  if (!SHA.test(a.head_sha ?? "")) errors.push("head_sha must be a full 40-hex SHA");
  if (v === 2 && !SHA.test(a.base_sha ?? "")) errors.push("v2 base_sha must be a full 40-hex SHA");
  if (a.verdict !== "PASS" && a.verdict !== "BLOCK") errors.push("verdict must be PASS or BLOCK");
  if (!Array.isArray(a.findings)) errors.push("findings must be an array");

  (Array.isArray(a.findings) ? a.findings : []).forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!f || typeof f !== "object") return errors.push(`${at} is not an object`);
    if (!str(f.location)) errors.push(`${at}.location missing`);
    if (!str(f.finding)) errors.push(`${at}.finding missing`);
    if (v === 1) {
      if (!str(f.id)) errors.push(`${at}.id missing`);
      if (!SEVERITIES.has(String(f.severity).toLowerCase())) errors.push(`${at}.severity invalid`);
      return;
    }
    if (!ID.test(f.id ?? "")) errors.push(`${at}.id must be a stable fingerprint`);
    const status = f.status ?? "confirmed";
    if (!STATUSES.has(status)) errors.push(`${at}.status must be confirmed|needs_validation|rejected`);
    if (status === "confirmed" && !SEVERITIES.has(f.severity)) errors.push(`${at}.severity invalid`);
    if (status !== "confirmed" && f.severity != null) errors.push(`${at}: ${status} must not carry severity`);
    if (f.resolution != null && !RESOLUTIONS.has(f.resolution)) errors.push(`${at}.resolution must be fixed|deferred|accepted`);
    const blocking = status === "confirmed" && (f.severity === "critical" || f.severity === "high");
    if (blocking && a.verdict === "PASS" && f.resolution !== "fixed") errors.push(`${at}: PASS with unfixed ${f.severity}`);
  });

  const mismatch = [];
  if (head && a.head_sha !== head) mismatch.push("head_sha does not match MR head");
  if (base && a.base_sha !== base) mismatch.push(v === 1 ? "v1 has no base_sha" : "base_sha does not match MR base");
  const trusted = errors.length === 0 && v === 2 && Boolean(head) && Boolean(base) && mismatch.length === 0;
  return { errors, mismatch, trusted };
}

if (import.meta.main) {
  const [file, ...rest] = process.argv.slice(2);
  const opt = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (!file) { console.error("usage: validate-review-artifact.mjs <artifact.json> [--head SHA] [--base SHA]"); process.exit(2); }
  if (statSync(file).size > 1 << 20) { console.log("INVALID: artifact over 1 MiB"); process.exit(1); }
  let artifact;
  try { artifact = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log(`INVALID: ${e.message}`); process.exit(1); }
  const r = validate(artifact, { head: opt("--head"), base: opt("--base") });
  if (r.errors.length) { console.log(`INVALID:\n- ${r.errors.join("\n- ")}`); process.exit(1); }
  console.log(r.trusted ? "TRUSTED" : `READABLE${r.mismatch.length ? `: ${r.mismatch.join("; ")}` : ""}`);
}
