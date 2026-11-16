#!/usr/bin/env node
// One review round: build the diff package, union reviewer reports into a verdict, write the REVIEW-ARTIFACT.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parse, SEV } from "./parse-review.mjs";
import { validate } from "../../andx-mr-review/scripts/validate-review-artifact.mjs";

const USAGE = `review: package a diff for reviewers, union their reports, write the REVIEW-ARTIFACT.

  package --base B --head H --out F         commit list, --stat and a -U10 diff of B..H into F;
                                            exit 3 when B..H is empty or H does not descend from B
  union --base B --head H --reports DIR     verdict JSON on stdout from DIR/andx-review-<S>-<reviewer>.json|.txt
                                            (.json wins when a reviewer has both)
        --slug S --expect r1,r2 [--refuters R.json] [--round N --prior V.json]
  artifact --verdict V.json --plan P --out F [--target main] [--source andx-execute-and-review]
                                            v2 REVIEW-ARTIFACT, validated; INVALID prints reasons, exit 1, no file
  collect --agent ID --reviewer R --slug S --reports DIR [--transcripts ROOT]
                                            Cursor: copies subagent ID's final message from
                                            ROOT/*/agent-transcripts/*/subagents/ID.jsonl (ROOT default ~/.cursor/projects)
                                            to DIR/andx-review-<S>-<R>.json when it is a JSON report, else .txt,
                                            removing R's other-extension report; exit 2 when not found

Common: --repo DIR (default cwd)

union, in order:
  reviewer     the <reviewer> part, with andx- and -review/-reviewer folded, must be one of bugbot security
               ponytail spec audit react a11y ux-api refuter; other files are skipped
  expect       --expect lists those canonical names; an expected reviewer with no report lands in unparsed
  parse        parse-review.mjs; an UNPARSED report lands in unparsed and forces BLOCK
  id           security: trailing "(fingerprint)"; others: slug of file name + first finding words
  paths        exact match with / separators; a finding's leading ./ is dropped, and a/ or b/ too when
               the path with it is not in the diff
  same root    same id, or same file within 3 lines sharing a word of 4+ letters, never two different
               fingerprints; reviewers[] merged
  per finding  ids rejected in V.json drop as prior-rejected; refuter decisions in R.json
               [{id|fingerprint, decision, reason, severity?, blockers?, validation_plan?}] apply to the
               finding with that id (or, for a finding that confirms a prior blocker, that blocker's id):
               rejected -> rejected, needs_validation or a bad decision -> advisory,
               confirmed keeps (severity overrides); the rest of its group stays
  prior        a finding on a prior blocker's root (a Low/nitpick only when a refuter decided that blocker),
               or a High/Critical from one of its reviewers in its
               file, confirms it and keeps the higher severity (refuter-decided ones excepted); an
               unconfirmed prior blocker moves to fixed only when it lists
               reviewers and all of them reported this round, else it stays a blocker;
               advisory/deferred/fixed/rejected carry over, deduplicated by id
  wrong-base   a new finding (spec excepted) whose file is not in git diff --name-only B..H is dropped
  round-scope  round >= 2: a new finding with a line that is not an added line of B..H is dropped
  quoted line  a new High/Critical not confirmed by a refuter needs a \`backtick\` or "> " snippet, or a bare
               evidence line, (3+ chars, a leading diff +/- ignored) found in an added, context or removed
               diff line within 3 lines of it, or,
               from bugbot, a start line that is an added line; else it drops to medium
  fail closed  a reviewer whose report says BLOCK lands in unparsed when it has no Critical/High, or one
               that is neither in blockers nor decided by a refuter (now or as prior-rejected); check by hand
  verdict      blockers: Critical/High; advisory: Medium, needs_validation; deferred: Low, nitpick;
               dropped: wrong-base, round-scope, prior-rejected. status BLOCK on blockers or unparsed.
  variants     security's "variants: f:1, g:2" line or "- f:1" list under it (unfixed copies of a fixed
               pattern) -> leading path:line of each entry, plus V.json's, deduplicated; none -> no field
  heads        head_sha = H; review_head_sha = V.json's review_head_sha, else its head_sha, else H (round 1)
               pinned at refs/andx/reviewed/<S> so gc keeps it; a failed update only warns
artifact copies review_head_sha and a non-empty variants[].
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
export const reviewerOf = (name) => {
  const n = name.toLowerCase().replace(/\.(txt|json)$/, "").replace(/-review(er)?$/, "").replace(/^andx-/, "");
  return REVIEWERS.includes(n) ? n : undefined;
};

// git C-quotes paths with ", \ or control characters: "b/q\"x" and octal \303\244 byte escapes
const ESC = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  for (const [, oct, esc, raw] of s.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/gs)) {
    if (oct) bytes.push(parseInt(oct, 8));
    else if (esc) bytes.push(ESC[esc] ?? esc.charCodeAt(0));
    else bytes.push(...Buffer.from(raw));
  }
  return Buffer.from(bytes).toString();
}

// per file: line -> [{text, kind}]; "+" and " " keyed by new-side line, "-" by old-side line
export function diffLines(text) {
  const files = new Map();
  const header = (l) => unquote(l.slice(4).replace(/\t$/, "")).replace(/^[ab]\//, "");
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

const where = (location, names) => {
  const s = location.replace(/`/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
  const m = s.match(/^(.*?):(\d+)/);
  const file = m ? m[1] : s;
  return { file: names.has(file) ? file : file.replace(/^[ab]\//, ""), line: m ? Number(m[2]) : null };
};
const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
// Root cause = a shared word near the same line: misses rephrased duplicates, merges same-word neighbours.
const sameRoot = (a, b) => a.id === b.id || (a.file === b.file && a.line != null && b.line != null
  && Math.abs(a.line - b.line) <= 3 && [...words(a.finding)].some((w) => words(b.finding).has(w)));
const rank = (f) => (f.status === "needs_validation" ? 0.5 : SEV[f.severity]);
const pub = ({ file, line, text, ev, quoted, fp, confirms, refuted, members, high, settled, ...f }) => f;
const entries = (lines, from, to) => [...(lines ?? [])].filter(([k]) => from == null || (k >= from && k <= to)).flatMap(([, es]) => es);
const added = (lines, line) => Boolean(lines?.get(line)?.some((e) => e.kind === "+"));

function quotedIn(lines, f) {
  if (f.reviewers[0] === "bugbot" && added(lines, f.line)) return true;
  // Reviewers paste diff lines with their +/- marker, or put a bare line in the evidence field.
  const raw = [...f.text.matchAll(/`([^`\n]+)`/g), ...f.text.matchAll(/^[ \t]*>[ \t]?(.*)$/gm)].map((m) => m[1])
    .concat(/^[ \t]*>|`/m.test(f.ev) ? [] : f.ev.split("\n"));
  const snippets = raw.flatMap((s) => [s.trim(), s.trim().replace(/^[+-](?![+-])/, "").trim()]).filter((s) => s.length >= 3);
  const near = entries(lines, f.line == null ? null : f.line - 3, f.line + 3).map((e) => e.text);
  return snippets.some((s) => near.some((l) => l.includes(s)));
}

function normalize(raw, reviewer, files, names) {
  const fp = reviewer === "security" ? raw.finding.match(/\s*\(([A-Za-z0-9][A-Za-z0-9._:/@+-]*)\)\s*$/) : null;
  const finding = fp ? raw.finding.slice(0, fp.index) : raw.finding;
  const { file, line } = where(raw.location, names);
  const nv = raw.severity === "needs_validation";
  const f = {
    id: fp?.[1] ?? (`${path.basename(file)} ${finding}`.toLowerCase().match(/[a-z0-9]+/g) ?? ["finding"]).slice(0, 8).join("-"),
    status: nv ? "needs_validation" : "confirmed",
    ...(nv ? {} : { severity: raw.severity in SEV ? raw.severity : "low" }),
    location: raw.location, finding, reviewers: [reviewer], file, line,
    fp: Boolean(fp), text: `${finding}\n${raw.evidence ?? ""}`, ev: raw.evidence ?? "", high: SEV[raw.severity] >= 3,
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
  refuted: g.some((m) => m.refuted),
  members: g,
});

function decide(m, d) {
  m.settled = true;
  if (d.decision === "confirmed") return Object.assign(m, { refuted: true, ...(d.severity in SEV && { severity: d.severity }) });
  delete m.severity;
  const ok = d.decision === "needs_validation";
  Object.assign(m, { status: "needs_validation", blockers: ok ? d.blockers ?? [] : ["refuter_unparsed"], ...(ok && d.validation_plan && { validation_plan: d.validation_plan }), reason: d.reason });
}

export function union({ reports, files, names, expect = [], refuters = [], round = 1, prior }) {
  const unparsed = expect.filter((r) => !reports.some((x) => x.reviewer === r));
  const reported = new Set();
  const blocking = new Set();
  let secrets;
  const variants = new Set(prior?.variants);
  const groups = [];
  for (const { reviewer, text } of reports) {
    const r = parse(text, reviewer);
    if (r.status === "UNPARSED") unparsed.push(reviewer);
    else reported.add(reviewer);
    if (r.status === "BLOCK") blocking.add(reviewer);
    if (reviewer === "security") {
      secrets = text.match(/secrets_scan:\s*(RAN|NOT_RUN)/)?.[1] ?? secrets;
      // Same-line comma list or a "- f:1" list under the key (stops at the first non-item line);
      // each entry keeps its leading path:line, so "a.go:3:12 (note)" -> a.go:3; none/free text drop.
      const m = text.replace(/\r\n?/g, "\n").match(/^[ \t]*variants:[ \t]*(.*)\n?((?:[ \t]*-.*(?:\n|$))*)/m);
      const raw = m ? [...m[1].split(","), ...m[2].split("\n").map((l) => l.replace(/^[ \t]*-/, ""))] : [];
      for (const s of raw) {
        const e = s.replace(/^[\s`]+/, "").match(/^([^\s`,]+?:\d+)/)?.[1];
        if (e) variants.add(e);
      }
    }
    // O(n^2) grouping; fine for tens of findings per round.
    for (const f of r.findings.map((x) => normalize(x, reviewer, files, names))) {
      const g = groups.find((x) => x.some((m) => sameRoot(m, f)) && !x.some((m) => m.fp && f.fp && m.id !== f.id));
      g ? g.push(f) : groups.push([f]);
    }
  }

  const rejectedBefore = new Set((prior?.rejected ?? []).map((f) => f.id));
  const priorBlockers = (prior?.blockers ?? []).map((p) => ({ ...p, ...where(p.location, names) }));
  const decisions = new Map(refuters.map((r) => [r.id ?? r.fingerprint, r]));
  const out = { blockers: [], advisory: [], deferred: [], rejected: [], dropped: [] };
  const confirmed = new Set();

  for (const group of groups) {
    const g = [];
    for (const m of group) {
      const d = decisions.get(m.id);
      if (rejectedBefore.has(m.id)) out.dropped.push({ ...pub(m), reason: "prior-rejected" });
      else if (d?.decision === "rejected") {
        delete m.severity;
        out.rejected.push({ ...pub(m), status: "rejected", reason: d.reason });
      } else {
        if (d) decide(m, d);
        g.push(m);
        continue;
      }
      m.settled = true;
    }
    if (!g.length) continue;

    const f = merge(g);
    // A Low or nitpick near a fixed blocker is a note, not a re-raise, unless a refuter decided that blocker.
    const strong = f.status === "needs_validation" || SEV[f.severity] >= 2;
    const p = priorBlockers.find((b) => sameRoot(b, f) && (strong || decisions.has(b.id)))
      ?? (SEV[f.severity] >= 3 ? priorBlockers.find((b) => !confirmed.has(b.id) && b.file === f.file && b.reviewers?.some((r) => f.reviewers.includes(r))) : null);
    if (p) {
      Object.assign(f, { id: p.id, confirms: true });
      confirmed.add(p.id);
      // verdict.json shows the inherited id, so a refuter decision may name it rather than a member id
      const pd = !f.refuted && decisions.get(p.id);
      if (pd?.decision === "rejected") {
        delete f.severity;
        g.forEach((m) => (m.settled = true));
        out.rejected.push({ ...pub(f), status: "rejected", reason: pd.reason });
        continue;
      }
      if (pd) decide(f, pd);
      if (f.status === "confirmed" && !f.refuted && SEV[p.severity] > SEV[f.severity]) f.severity = p.severity;
    }
    const lines = files.get(f.file);
    const reason = f.confirms ? null
      : !f.reviewers.includes("spec") && !names.has(f.file) ? "wrong-base"
      : round >= 2 && f.line != null && !added(lines, f.line) ? "round-scope" : null;
    if (reason) {
      out.dropped.push({ ...pub(f), reason });
      continue;
    }
    if (f.status === "confirmed" && SEV[f.severity] >= 3 && !f.quoted && !f.refuted && !f.confirms) Object.assign(f, { demoted_from: f.severity, severity: "medium" });

    const bucket = f.status === "needs_validation" || f.severity === "medium" ? "advisory" : SEV[f.severity] >= 3 ? "blockers" : "deferred";
    if (bucket === "blockers") g.forEach((m) => (m.settled = true));
    out[bucket].push(pub(f));
  }

  const fixed = [...(prior?.fixed ?? [])];
  for (const p of priorBlockers.filter((b) => !confirmed.has(b.id))) {
    if (p.reviewers?.length && p.reviewers.every((r) => reported.has(r))) fixed.push({ ...pub(p), resolution: "fixed" });
    else out.blockers.push(pub(p));
  }
  for (const r of blocking) {
    const highs = groups.flat().filter((m) => m.reviewers[0] === r && m.high);
    if (!highs.length || highs.some((m) => !m.settled)) unparsed.push(r);
  }

  const carry = (k) => {
    const ids = new Set(out[k].map((f) => f.id));
    return [...(prior?.[k] ?? []).filter((f) => !ids.has(f.id)), ...out[k]];
  };
  return {
    status: out.blockers.length || unparsed.length ? "BLOCK" : "PASS",
    round,
    ...((secrets ?? prior?.secrets_scan) && { secrets_scan: secrets ?? prior.secrets_scan }),
    ...(variants.size && { variants: [...variants] }),
    blockers: out.blockers,
    advisory: carry("advisory"),
    deferred: carry("deferred"),
    fixed,
    rejected: carry("rejected"),
    dropped: out.dropped,
    unparsed,
  };
}

// The last assistant entry of a Cursor subagent transcript is its final reply.
export function finalMessage(root, agent) {
  if (!/^[A-Za-z0-9-]+$/.test(agent)) return null;
  const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name)) : []);
  const file = dirs(root).flatMap((proj) => dirs(path.join(proj, "agent-transcripts")))
    .map((conv) => path.join(conv, "subagents", `${agent}.jsonl`)).find((f) => fs.existsSync(f));
  if (!file) return null;
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n").reverse()) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.role !== "assistant") continue;
    const text = (e.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (text) return text;
  }
  return null;
}

export function artifact(v, { plan, target = "main", source = "andx-execute-and-review" }) {
  const list = (k, extra) => (v[k] ?? []).map(({ reason, ...f }) => ({ ...f, ...(k === "rejected" && reason && { reason }), ...extra }));
  return {
    schema_version: 2, source, plan, target_branch: target, base_sha: v.base_sha, head_sha: v.head_sha,
    ...(v.review_head_sha && { review_head_sha: v.review_head_sha }),
    reviewed_at: new Date().toISOString(), verdict: v.status, ...(v.secrets_scan && { secrets_scan: v.secrets_scan }),
    ...(v.variants?.length && { variants: v.variants }),
    findings: [...list("blockers"), ...list("advisory"), ...list("deferred", { resolution: "deferred" }), ...list("fixed"), ...list("rejected")],
  };
}

if (import.meta.main) {
  const { values: o, positionals: [cmd] } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(["base", "head", "out", "repo", "reports", "slug", "expect", "refuters", "round", "prior", "verdict", "plan", "target", "source", "agent", "reviewer", "transcripts"]
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
    need("base", "head", "reports", "slug", "expect");
    const expect = o.expect.split(",").map((s) => s.trim());
    if (!expect.every((r) => REVIEWERS.includes(r))) fail(2, `union: --expect takes canonical names: ${REVIEWERS.join(",")}`);
    const round = Number(o.round ?? 1);
    if (!Number.isInteger(round) || round < 1 || (round >= 2 && !o.prior)) fail(2, "union: --round N >= 2 needs --prior");
    const [base, head] = [sha(repo, o.base), sha(repo, o.head)];
    const prefix = `andx-review-${o.slug}-`;
    // A reviewer's .json report wins over its .txt one, so a re-requested JSON verdict replaces the prose.
    const byReviewer = new Map();
    for (const n of fs.readdirSync(o.reports).filter((n) => /\.(txt|json)$/.test(n) && n.startsWith(prefix)).sort()) {
      const reviewer = reviewerOf(n.slice(prefix.length));
      if (!reviewer) console.error(`skipped ${n}: unknown reviewer`);
      else if (!byReviewer.has(reviewer) || n.endsWith(".json")) byReviewer.set(reviewer, { reviewer, text: fs.readFileSync(path.join(o.reports, n), "utf8") });
    }
    const reports = [...byReviewer.values()];
    const prior = o.prior ? readJson(o.prior) : undefined;
    const refuters = o.refuters ? readJson(o.refuters) : [];
    if (!Array.isArray(refuters) || !refuters.every((r) => r && typeof r === "object")) fail(2, "union: --refuters must be a JSON array of objects");
    const names = new Set(diff(repo, base, head, "--name-only", "-z").split("\0").filter(Boolean));
    const v = union({ reports, files: diffLines(diff(repo, base, head, "-U10")), names, expect, refuters, round, prior });
    const reviewed = prior?.review_head_sha ?? prior?.head_sha ?? head;
    const ref = `refs/andx/reviewed/${o.slug}`;
    if (git(repo, ["rev-parse", "-q", "--verify", ref]).stdout.trim() !== reviewed) {
      const u = git(repo, ["update-ref", ref, reviewed]);
      if (u.status !== 0) console.error(`warning: ${ref} not updated: ${u.stderr.trim()}`);
    }
    console.log(JSON.stringify({ ...v, base_sha: prior?.base_sha ?? base, head_sha: head, review_head_sha: reviewed }, null, 2));
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
  } else if (cmd === "collect") {
    need("agent", "reviewer", "slug", "reports");
    if (!REVIEWERS.includes(o.reviewer)) fail(2, `collect: --reviewer takes canonical names: ${REVIEWERS.join(",")}`);
    const text = finalMessage(o.transcripts ?? path.join(os.homedir(), ".cursor", "projects"), o.agent);
    if (text == null) fail(2, `collect: no final message for subagent ${o.agent}`);
    const ext = parse(text, o.reviewer).status !== "UNPARSED" && /^\s*(```(json)?\s*)?\{/.test(text) ? "json" : "txt";
    const base = path.join(o.reports, `andx-review-${o.slug}-${o.reviewer}`);
    fs.rmSync(`${base}.${ext === "json" ? "txt" : "json"}`, { force: true });
    fs.writeFileSync(`${base}.${ext}`, text.endsWith("\n") ? text : `${text}\n`);
    console.log(`COLLECTED ${base}.${ext}`);
  } else fail(2, USAGE);
}
