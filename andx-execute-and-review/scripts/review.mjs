#!/usr/bin/env node
// One review round: build the diff package, union reviewer reports into a verdict, write the REVIEW-ARTIFACT.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parse } from "./parse-review.mjs";
import { validate } from "../../andx-mr-review/scripts/validate-review-artifact.mjs";

const USAGE = `review: package a diff for reviewers, union their reports, write the REVIEW-ARTIFACT.

  package --base B --head H --out F         commit list, --stat and a -U10 diff of B..H into F;
                                            exit 3 when B..H is empty or H does not descend from B
  union --base B --head H --reports DIR     verdict JSON on stdout from every DIR/*.txt report
        [--refuters R.json] [--round N --prior V.json]
  artifact --verdict V.json --plan P --out F [--target main] [--source andx-execute-and-review]
                                            v2 REVIEW-ARTIFACT, validated; INVALID prints reasons, exit 1, no file

Common: --repo DIR (default cwd)

union, in order:
  reviewer     file name suffix (andx-review-<slug>-<reviewer>.txt); -review/-reviewer and andx- folded to
               bugbot security ponytail spec audit react a11y ux-api refuter; other files skipped
  parse        parse-review.mjs; UNPARSED, or BLOCK without a Critical/High line, lands in unparsed and
               forces BLOCK (rewrite that report as a VERDICT block and rerun)
  id           security: trailing "(fingerprint)"; others: slug of file name + first finding words
  same root    same id, or same file within 3 lines sharing a word of 4+ letters; reviewers[] merged
  prior        ids in V.json rejected are dropped; a finding on a prior blocker's root confirms it;
               prior blockers not confirmed move to fixed; advisory/deferred/fixed/rejected carry over
  wrong-base   a new finding (spec excepted) whose file:line is outside the -U10 diff of B..H is dropped
  round-scope  round >= 2: a new finding not on an added line of B..H is dropped
  refuters     R.json [{id|fingerprint, decision, reason, severity?, blockers?, validation_plan?}]:
               rejected -> rejected; needs_validation or a bad decision -> advisory; confirmed keeps
  quoted line  a new High/Critical not confirmed by a refuter needs a \`backtick\` or "> " snippet
               (3+ chars) found in an added or context diff line within 3 lines of it; else medium
  verdict      blockers: Critical/High; advisory: Medium, needs_validation; deferred: Low, nitpick;
               dropped: wrong-base, round-scope, prior-rejected. status BLOCK on blockers or unparsed.
Exit: 0 ok, 1 artifact INVALID, 2 usage, 3 empty or unrelated range.`;

const REVIEWERS = ["bugbot", "security", "ponytail", "spec", "audit", "react", "a11y", "ux-api", "refuter"];
const SEV = { __proto__: null, critical: 4, high: 3, medium: 2, low: 1, nitpick: 0 };
const STOP = new Set(["this", "that", "with", "when", "from", "into", "than", "then", "have", "does", "will", "should", "could", "would"]);

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const git = (repo, args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const sha = (repo, ref) => {
  const r = git(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : fail(2, `unknown commit ${ref}`);
};
const diff = (repo, base, head, ...a) => git(repo, ["diff", "--no-color", "--no-ext-diff", ...a, `${base}..${head}`]).stdout;

export const reviewerOf = (file) => {
  const n = path.basename(file).toLowerCase().replace(/\.[^.]*$/, "").replace(/-review(er)?$/, "");
  return REVIEWERS.find((r) => n === r || n.endsWith(`-${r}`));
};

// new-side line number -> {text, added} per file, from a unified diff
export function diffLines(text) {
  const files = new Map();
  let cur, n;
  for (const l of text.split("\n")) {
    if (l.startsWith("diff --git ")) [cur, n] = [null, null];
    else if (n == null && l.startsWith("+++ ")) {
      cur = l === "+++ /dev/null" ? null : new Map();
      if (cur) files.set(l.slice(4).replace(/^b\//, ""), cur);
    } else if (/^@@ /.test(l)) n = Number(l.match(/\+(\d+)/)[1]);
    else if (cur && n != null && (l[0] === "+" || l[0] === " ")) cur.set(n++, { text: l.slice(1), added: l[0] === "+" });
  }
  return files;
}

const where = (location) => {
  const s = location.replace(/`/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
  const m = s.match(/^(.*?):(\d+)/);
  return { file: m ? m[1] : s, line: m ? Number(m[2]) : null };
};
const sameFile = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
// Root cause = a shared word near the same line: misses rephrased duplicates, merges same-word neighbours.
const sameRoot = (a, b) => a.id === b.id || (sameFile(a.file, b.file) && a.line != null && b.line != null
  && Math.abs(a.line - b.line) <= 3 && [...words(a.finding)].some((w) => words(b.finding).has(w)));
const rank = (f) => (f.status === "needs_validation" ? 0.5 : SEV[f.severity]);
const pub = ({ file, line, text, quoted, fp, confirms, refuted, ...f }) => f;

function quotedIn(lines, f) {
  const snippets = [...f.text.matchAll(/`([^`\n]+)`/g), ...f.text.matchAll(/^[ \t]*>[ \t]?(.*)$/gm)].map((m) => m[1].trim()).filter((s) => s.length >= 3);
  const near = [...(lines ?? [])].filter(([n]) => f.line == null || Math.abs(n - f.line) <= 3).map(([, l]) => l.text);
  return snippets.some((s) => near.some((l) => l.includes(s)));
}

function normalize(raw, reviewer, files) {
  const fp = reviewer === "security" ? raw.finding.match(/\s*\(([A-Za-z0-9][A-Za-z0-9._:/@+-]*)\)\s*$/) : null;
  const finding = fp ? raw.finding.slice(0, fp.index) : raw.finding;
  const { file, line } = where(raw.location);
  const nv = raw.severity === "needs_validation";
  const f = {
    id: fp?.[1] ?? (`${path.basename(file)} ${finding}`.toLowerCase().match(/[a-z0-9]+/g) ?? ["finding"]).slice(0, 8).join("-"),
    status: nv ? "needs_validation" : "confirmed",
    ...(nv ? {} : { severity: raw.severity in SEV ? raw.severity : "low" }),
    location: raw.location, finding, reviewers: [reviewer], file, line, fp: Boolean(fp), text: `${finding}\n${raw.evidence ?? ""}`,
  };
  f.quoted = quotedIn(files.get([...files.keys()].find((k) => sameFile(k, file))), f);
  return f;
}

export function union({ reports, files, refuters = [], round = 1, prior }) {
  const unparsed = [];
  let secrets;
  const all = [];
  for (const { reviewer, text } of reports) {
    const r = parse(text, reviewer);
    if (r.status === "UNPARSED" || (r.status === "BLOCK" && !r.findings.some((f) => SEV[f.severity] >= 3))) unparsed.push(reviewer);
    if (reviewer === "security") secrets = text.match(/secrets_scan:\s*(RAN|NOT_RUN)/)?.[1] ?? secrets;
    all.push(...r.findings.map((f) => normalize(f, reviewer, files)));
  }

  // O(n^2) grouping; fine for tens of findings per round.
  const groups = [];
  for (const f of all) {
    const g = groups.find((x) => sameRoot(x, f));
    if (!g) {
      groups.push(f);
      continue;
    }
    g.reviewers = [...new Set([...g.reviewers, ...f.reviewers])];
    g.quoted ||= f.quoted;
    if (f.fp && !g.fp) Object.assign(g, { id: f.id, fp: true });
    if (rank(f) > rank(g)) {
      Object.assign(g, { status: f.status, location: f.location, finding: f.finding, file: f.file, line: f.line });
      if (f.severity) g.severity = f.severity;
      else delete g.severity;
    }
  }

  const rejectedBefore = new Set((prior?.rejected ?? []).map((f) => f.id));
  const priorBlockers = (prior?.blockers ?? []).map((p) => ({ ...p, ...where(p.location) }));
  const decisions = new Map(refuters.map((r) => [r.id ?? r.fingerprint, r]));
  const out = { blockers: [], advisory: [], deferred: [], rejected: [], dropped: [] };
  const confirmed = new Set();

  for (const f of groups) {
    const p = priorBlockers.find((b) => sameRoot(b, f));
    if (p) Object.assign(f, { id: p.id, confirms: true }), confirmed.add(p.id);
    const lines = files.get([...files.keys()].find((k) => sameFile(k, f.file)));
    const reason = rejectedBefore.has(f.id) ? "prior-rejected"
      : f.confirms ? null
      : !f.reviewers.includes("spec") && !(lines && (f.line == null || lines.has(f.line))) ? "wrong-base"
      : round >= 2 && !lines?.get(f.line)?.added ? "round-scope" : null;
    if (reason) {
      out.dropped.push({ ...pub(f), reason });
      continue;
    }

    const d = decisions.get(f.id);
    if (d?.decision === "rejected") {
      delete f.severity;
      out.rejected.push({ ...pub(f), status: "rejected", reason: d.reason });
      continue;
    }
    if (d?.decision === "confirmed") Object.assign(f, { refuted: true, ...(d.severity in SEV && { severity: d.severity }) });
    else if (d) {
      delete f.severity;
      const ok = d.decision === "needs_validation";
      Object.assign(f, { status: "needs_validation", blockers: ok ? d.blockers ?? [] : ["refuter_unparsed"], ...(ok && d.validation_plan && { validation_plan: d.validation_plan }), reason: d.reason });
    }
    if (f.status === "confirmed" && SEV[f.severity] >= 3 && !f.quoted && !f.refuted && !f.confirms) Object.assign(f, { demoted_from: f.severity, severity: "medium" });

    const bucket = f.status === "needs_validation" || f.severity === "medium" ? "advisory" : SEV[f.severity] >= 3 ? "blockers" : "deferred";
    out[bucket].push(pub(f));
  }

  const carry = (k) => [...(prior?.[k] ?? []), ...(out[k] ?? [])];
  return {
    status: out.blockers.length || unparsed.length ? "BLOCK" : "PASS",
    round,
    ...((secrets ?? prior?.secrets_scan) && { secrets_scan: secrets ?? prior.secrets_scan }),
    blockers: out.blockers,
    advisory: carry("advisory"),
    deferred: carry("deferred"),
    fixed: [...(prior?.fixed ?? []), ...priorBlockers.filter((p) => !confirmed.has(p.id)).map((p) => ({ ...pub(p), resolution: "fixed" }))],
    rejected: carry("rejected"),
    dropped: out.dropped,
    unparsed,
  };
}

export function artifact(v, { plan, target = "main", source = "andx-execute-and-review" }) {
  const list = (k, extra) => (v[k] ?? []).map(({ reason, ...f }) => ({ ...f, ...(k === "rejected" && reason && { reason }), ...extra }));
  return {
    schema_version: 2, source, plan, target_branch: target, base_sha: v.base_sha, head_sha: v.head_sha,
    reviewed_at: new Date().toISOString(), verdict: v.status, ...(v.secrets_scan && { secrets_scan: v.secrets_scan }),
    findings: [...list("blockers"), ...list("advisory"), ...list("deferred", { resolution: "deferred" }), ...list("fixed"), ...list("rejected")],
  };
}

if (import.meta.main) {
  const { values: o, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(["base", "head", "out", "repo", "reports", "refuters", "round", "prior", "verdict", "plan", "target", "source"]
      .map((k) => [k, { type: "string" }]).concat([["help", { type: "boolean", short: "h" }]])),
  });
  if (o.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const repo = path.resolve(o.repo ?? ".");
  const need = (...ks) => ks.forEach((k) => o[k] ?? fail(2, `${cmd}: --${k} required\n\n${USAGE}`));

  if (cmd === "package") {
    need("base", "head", "out");
    const [base, head] = [sha(repo, o.base), sha(repo, o.head)];
    if (git(repo, ["merge-base", "--is-ancestor", base, head]).status !== 0) fail(3, `${o.head} does not descend from ${o.base}`);
    const commits = git(repo, ["log", "--oneline", "--no-decorate", `${base}..${head}`]).stdout;
    if (!commits.trim()) fail(3, `empty range ${o.base}..${o.head}`);
    fs.writeFileSync(o.out, `base ${base}\nhead ${head}\n\n## Commits\n${commits}\n## Stat\n${diff(repo, base, head, "--stat")}\n## Diff (-U10)\n${diff(repo, base, head, "-U10")}`);
    console.log(`PACKAGE ${o.out} commits=${commits.trim().split("\n").length}`);
  } else if (cmd === "union") {
    need("base", "head", "reports");
    const round = Number(o.round ?? 1);
    if (!Number.isInteger(round) || round < 1 || (round >= 2 && !o.prior)) fail(2, "union: --round N >= 2 needs --prior");
    const [base, head] = [sha(repo, o.base), sha(repo, o.head)];
    const reports = fs.readdirSync(o.reports).filter((n) => n.endsWith(".txt")).sort().flatMap((n) => {
      const reviewer = reviewerOf(n);
      if (!reviewer) return console.error(`skipped ${n}: unknown reviewer`), [];
      return [{ reviewer, text: fs.readFileSync(path.join(o.reports, n), "utf8") }];
    });
    const prior = o.prior ? readJson(o.prior) : undefined;
    const refuters = o.refuters ? readJson(o.refuters) : [];
    if (!Array.isArray(refuters) || !refuters.every((r) => r && typeof r === "object")) fail(2, "union: --refuters must be a JSON array of objects");
    const v = union({ reports, files: diffLines(diff(repo, base, head, "-U10")), refuters, round, prior });
    console.log(JSON.stringify({ ...v, base_sha: prior?.base_sha ?? base, head_sha: head }, null, 2));
  } else if (cmd === "artifact") {
    need("verdict", "plan", "out");
    const a = artifact(readJson(o.verdict), o);
    const { errors } = validate(a);
    if (errors.length) {
      console.log(`INVALID:\n- ${errors.join("\n- ")}`);
      process.exit(1);
    }
    fs.writeFileSync(o.out, `${JSON.stringify(a, null, 2)}\n`);
    console.log(`WROTE ${o.out}`);
  } else fail(2, USAGE);
}
