#!/usr/bin/env node
// One review round: build the diff package, union reviewer reports into a verdict, write the REVIEW-ARTIFACT.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parse, SEV } from "./parse-review.mjs";
import { validate } from "../../andx-mr-review/scripts/validate-review-artifact.mjs";

const USAGE = `review: package a diff for reviewers, union their reports, write the REVIEW-ARTIFACT.

  package --base B --head H --out F         commit list, --stat and a -U10 diff of B..H into F;
                                            exit 3 when B..H is empty or H does not descend from B
  union --base B --head H --reports DIR     verdict JSON on stdout from DIR/*.txt reports
        [--slug S] [--refuters R.json] [--round N --prior V.json]
  artifact --verdict V.json --plan P --out F [--target main] [--source andx-execute-and-review]
                                            v2 REVIEW-ARTIFACT, validated; INVALID prints reasons, exit 1, no file

Common: --repo DIR (default cwd)

union, in order:
  reviewer     with --slug, only andx-review-<S>-<reviewer>.txt; otherwise any file name ending in a reviewer.
               andx- and -review/-reviewer are folded to bugbot security ponytail spec audit react a11y
               ux-api refuter; other files are skipped
  parse        parse-review.mjs; an UNPARSED report lands in unparsed and forces BLOCK
  id           security: trailing "(fingerprint)"; others: slug of file name + first finding words
  paths        exact match after dropping ./ and a/ or b/ and using / separators
  same root    same id, or same file within 3 lines sharing a word of 4+ letters; reviewers[] merged
  prior        ids in V.json rejected are dropped; a finding on a prior blocker's root, or a High/Critical
               from one of its reviewers in its file, confirms it; an unconfirmed prior blocker moves to
               fixed only when all its reviewers reported this round, else it stays a blocker;
               advisory/deferred/fixed/rejected carry over, deduplicated by id
  wrong-base   a new finding (spec excepted) whose file is not in git diff --name-only B..H is dropped
  round-scope  round >= 2: a new finding with a line that is not an added line of B..H is dropped
  refuters     R.json [{id|fingerprint, decision, reason, severity?, blockers?, validation_plan?}]:
               rejected -> the security member moves to rejected, other reviewers' members stay;
               needs_validation or a bad decision -> advisory; confirmed keeps
  quoted line  a new High/Critical not confirmed by a refuter needs a \`backtick\` or "> " snippet
               (3+ chars) found in an added, context or removed diff line within 3 lines of it, or,
               from bugbot, a start..end line range that covers an added line; else it drops to medium
  fail closed  a reviewer whose report says BLOCK but has no surviving Critical/High (refuter-decided
               ones excepted) lands in unparsed; check it by hand
  verdict      blockers: Critical/High; advisory: Medium, needs_validation; deferred: Low, nitpick;
               dropped: wrong-base, round-scope, prior-rejected. status BLOCK on blockers or unparsed.
Exit: 0 ok, 1 artifact INVALID, 2 usage, 3 empty or unrelated range.`;

const REVIEWERS = ["bugbot", "security", "ponytail", "spec", "audit", "react", "a11y", "ux-api", "refuter"];
const STOP = new Set(["this", "that", "with", "when", "from", "into", "than", "then", "have", "does", "will", "should", "could", "would"]);

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const git = (repo, args) => spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const sha = (repo, ref) => {
  const r = git(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : fail(2, `unknown commit ${ref}`);
};
const diff = (repo, base, head, ...a) =>
  git(repo, ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", ...a, `${base}..${head}`]).stdout;
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^[ab]\//, "");

export const reviewerOf = (file, exact = false) => {
  const n = path.basename(file).toLowerCase().replace(/\.[^.]*$/, "").replace(/-review(er)?$/, "").replace(/^andx-/, "");
  return REVIEWERS.find((r) => n === r || (!exact && n.endsWith(`-${r}`)));
};

// per file: line -> [{text, kind}]; "+" and " " keyed by new-side line, "-" by old-side line
export function diffLines(text) {
  const files = new Map();
  const header = (l) => norm(l.slice(4).replace(/\t$/, "").replace(/^[ab]\//, ""));
  let cur, o, n, from;
  const at = (k, e) => (cur.get(k) ?? cur.set(k, []).get(k)).push(e);
  for (const l of text.split("\n")) {
    if (l.startsWith("diff --git ")) [cur, n, from] = [null, null, null];
    else if (n == null && l.startsWith("--- ")) from = l === "--- /dev/null" ? null : header(l);
    else if (n == null && l.startsWith("+++ ")) {
      const p = l === "+++ /dev/null" ? from : header(l);
      if (p) files.set(p, (cur = new Map()));
    } else if (l.startsWith("@@ ")) [, o, n] = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/).map(Number);
    else if (cur && n != null && l[0] === "+") at(n++, { text: l.slice(1), kind: "+" });
    else if (cur && n != null && l[0] === " ") at((o++, n++), { text: l.slice(1), kind: " " });
    else if (cur && n != null && l[0] === "-") at(o++, { text: l.slice(1), kind: "-" });
  }
  return files;
}

const where = (location) => {
  const s = norm(location.replace(/`/g, ""));
  const m = s.match(/^(.*?):(\d+)/);
  return { file: m ? m[1] : s, line: m ? Number(m[2]) : null };
};
const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
// Root cause = a shared word near the same line: misses rephrased duplicates, merges same-word neighbours.
const sameRoot = (a, b) => a.id === b.id || (a.file === b.file && a.line != null && b.line != null
  && Math.abs(a.line - b.line) <= 3 && [...words(a.finding)].some((w) => words(b.finding).has(w)));
const rank = (f) => (f.status === "needs_validation" ? 0.5 : SEV[f.severity]);
const pub = ({ file, line, end, text, quoted, fp, confirms, refuted, members, ...f }) => f;
const entries = (lines, from, to) => [...(lines ?? [])].filter(([k]) => from == null || (k >= from && k <= to)).flatMap(([, es]) => es);

function quotedIn(lines, f) {
  if (f.reviewers[0] === "bugbot" && f.line != null && entries(lines, f.line, f.end).some((e) => e.kind === "+")) return true;
  const snippets = [...f.text.matchAll(/`([^`\n]+)`/g), ...f.text.matchAll(/^[ \t]*>[ \t]?(.*)$/gm)].map((m) => m[1].trim()).filter((s) => s.length >= 3);
  const near = entries(lines, f.line == null ? null : f.line - 3, f.line + 3).map((e) => e.text);
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
    location: raw.location, finding, reviewers: [reviewer], file, line, end: Math.max(line ?? 0, raw.end_line ?? 0),
    fp: Boolean(fp), text: `${finding}\n${raw.evidence ?? ""}`,
  };
  f.quoted = quotedIn(files.get(file), f);
  return f;
}

const merge = (g) => ({
  ...g.reduce((a, m) => (rank(m) > rank(a) ? m : a)),
  id: (g.find((m) => m.fp) ?? g[0]).id,
  fp: g.some((m) => m.fp),
  reviewers: [...new Set(g.flatMap((m) => m.reviewers))],
  quoted: g.some((m) => m.quoted),
  members: g,
});

export function union({ reports, files, names, refuters = [], round = 1, prior }) {
  const unparsed = [];
  const reported = new Set();
  const blocking = new Set();
  let secrets;
  const groups = [];
  for (const { reviewer, text } of reports) {
    const r = parse(text, reviewer);
    if (r.status === "UNPARSED") unparsed.push(reviewer);
    else reported.add(reviewer);
    if (r.status === "BLOCK") blocking.add(reviewer);
    if (reviewer === "security") secrets = text.match(/secrets_scan:\s*(RAN|NOT_RUN)/)?.[1] ?? secrets;
    // O(n^2) grouping; fine for tens of findings per round.
    for (const f of r.findings.map((x) => normalize(x, reviewer, files))) {
      const g = groups.find((x) => x.some((m) => sameRoot(m, f)));
      g ? g.push(f) : groups.push([f]);
    }
  }

  const rejectedBefore = new Set((prior?.rejected ?? []).map((f) => f.id));
  const priorBlockers = (prior?.blockers ?? []).map((p) => ({ ...p, ...where(p.location) }));
  const decisions = new Map(refuters.map((r) => [r.id ?? r.fingerprint, r]));
  const out = { blockers: [], advisory: [], deferred: [], rejected: [], dropped: [] };
  const confirmed = new Set();
  const refuterDecided = new Set();

  for (const g of groups) {
    let f = merge(g);
    const p = priorBlockers.find((b) => sameRoot(b, f))
      ?? (SEV[f.severity] >= 3 ? priorBlockers.find((b) => !confirmed.has(b.id) && b.file === f.file && b.reviewers?.some((r) => f.reviewers.includes(r))) : null);
    if (p) Object.assign(f, { id: p.id, confirms: true }), confirmed.add(p.id);
    const lines = files.get(f.file);
    const reason = rejectedBefore.has(f.id) ? "prior-rejected"
      : f.confirms ? null
      : !f.reviewers.includes("spec") && !names.has(f.file) ? "wrong-base"
      : round >= 2 && f.line != null && !lines?.get(f.line)?.some((e) => e.kind === "+") ? "round-scope" : null;
    if (reason) {
      out.dropped.push({ ...pub(f), reason });
      continue;
    }

    const d = decisions.get(f.id);
    if (d?.decision === "rejected") {
      for (const m of g.filter((x) => x.reviewers.includes("security"))) {
        delete m.severity;
        out.rejected.push({ ...pub(m), status: "rejected", reason: d.reason });
      }
      refuterDecided.add("security");
      const rest = g.filter((x) => !x.reviewers.includes("security"));
      if (!rest.length) continue;
      f = Object.assign(merge(rest), f.confirms && { id: f.id, confirms: true });
    } else if (d?.decision === "confirmed") Object.assign(f, { refuted: true, ...(d.severity in SEV && { severity: d.severity }) });
    else if (d) {
      delete f.severity;
      const ok = d.decision === "needs_validation";
      Object.assign(f, { status: "needs_validation", blockers: ok ? d.blockers ?? [] : ["refuter_unparsed"], ...(ok && d.validation_plan && { validation_plan: d.validation_plan }), reason: d.reason });
      refuterDecided.add("security");
    }
    if (f.status === "confirmed" && SEV[f.severity] >= 3 && !f.quoted && !f.refuted && !f.confirms) Object.assign(f, { demoted_from: f.severity, severity: "medium" });

    const bucket = f.status === "needs_validation" || f.severity === "medium" ? "advisory" : SEV[f.severity] >= 3 ? "blockers" : "deferred";
    out[bucket].push(pub(f));
  }

  const fixed = [...(prior?.fixed ?? [])];
  for (const p of priorBlockers.filter((b) => !confirmed.has(b.id))) {
    if ((p.reviewers ?? []).every((r) => reported.has(r))) fixed.push({ ...pub(p), resolution: "fixed" });
    else out.blockers.push(pub(p));
  }
  for (const r of blocking) if (!refuterDecided.has(r) && !out.blockers.some((b) => b.reviewers?.includes(r))) unparsed.push(r);

  const carry = (k) => {
    const ids = new Set(out[k].map((f) => f.id));
    return [...(prior?.[k] ?? []).filter((f) => !ids.has(f.id)), ...out[k]];
  };
  return {
    status: out.blockers.length || unparsed.length ? "BLOCK" : "PASS",
    round,
    ...((secrets ?? prior?.secrets_scan) && { secrets_scan: secrets ?? prior.secrets_scan }),
    blockers: out.blockers,
    advisory: carry("advisory"),
    deferred: carry("deferred"),
    fixed,
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
    options: Object.fromEntries(["base", "head", "out", "repo", "reports", "slug", "refuters", "round", "prior", "verdict", "plan", "target", "source"]
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
    const prefix = o.slug ? `andx-review-${o.slug}-` : "";
    const reports = fs.readdirSync(o.reports).filter((n) => n.endsWith(".txt") && n.startsWith(prefix)).sort().flatMap((n) => {
      const reviewer = reviewerOf(n.slice(prefix.length), Boolean(o.slug));
      if (!reviewer) return console.error(`skipped ${n}: unknown reviewer`), [];
      return [{ reviewer, text: fs.readFileSync(path.join(o.reports, n), "utf8") }];
    });
    const prior = o.prior ? readJson(o.prior) : undefined;
    const refuters = o.refuters ? readJson(o.refuters) : [];
    if (!Array.isArray(refuters) || !refuters.every((r) => r && typeof r === "object")) fail(2, "union: --refuters must be a JSON array of objects");
    const names = new Set(diff(repo, base, head, "--name-only", "-z").split("\0").filter(Boolean).map(norm));
    const v = union({ reports, files: diffLines(diff(repo, base, head, "-U10")), names, refuters, round, prior });
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
