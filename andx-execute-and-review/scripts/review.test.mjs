import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "bugbot");
const VALIDATOR = join(here, "..", "..", "andx-mr-review", "scripts", "validate-review-artifact.mjs");

const run = (args, cwd) => spawnSync(process.execPath, [join(here, "review.mjs"), ...args], { cwd, encoding: "utf8" });
const tmp = () => fs.mkdtempSync(join(os.tmpdir(), "review-test-"));

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function commit(repo, files, msg) {
  for (const [p, body] of Object.entries(files)) {
    if (body == null) {
      fs.rmSync(join(repo, p));
      continue;
    }
    fs.mkdirSync(dirname(join(repo, p)), { recursive: true });
    fs.writeFileSync(join(repo, p), body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD");
}

const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

// head rewrites src/x.go line 10, adds src/provider.ts, a spaced and a non-ASCII path, deletes gone.go
function repo() {
  const dir = tmp();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  const base = commit(dir, { "src/x.go": lines(30, (i) => `line ${i}`), "old.go": "old\n", "gone.go": "check(auth)\nok\n" }, "base");
  const head = commit(dir, {
    "src/x.go": lines(30, (i) => (i === 10 ? "v := items[0]" : `line ${i}`)),
    "src/provider.ts": lines(50, (i) => (i === 42 ? "init(provider)" : `p ${i}`)),
    "src/my file.ts": "a\nb\n",
    "src/ünï.ts": "c\n",
    "deep.go": "root\n",
    "a/deep.go": lines(5, (i) => `deep ${i}`),
    ...(process.platform !== "win32" && { 'src/q"x.go': "q\n" }),
    "gone.go": null,
  }, "change");
  return { dir, base, head };
}

// keys without .txt are reviewer names, written as andx-review-s-<name>.txt for --slug s
function union(r, reports, extra = []) {
  const dir = tmp();
  for (const [name, body] of Object.entries(reports)) fs.writeFileSync(join(dir, name.endsWith(".txt") ? name : `andx-review-s-${name}.txt`), body);
  const out = run(["union", "--base", r.base, "--head", r.head, "--reports", dir, "--repo", r.dir, "--slug", "s", ...extra]);
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

const verdict = (status, ...findings) => `## VERDICT\nstatus: ${status}\nblockers:\n${findings.map((f) => `  - ${f}\n`).join("")}`;
const bug = (file, line, title) => `<bug><title>${title}</title><file>${file}</file><start_line>${line}</start_line><end_line>${line}</end_line><severity>high</severity><description>d</description></bug>`;

test("package writes commits, stat and diff; refuses empty or unrelated ranges", () => {
  const r = repo();
  const out = join(tmp(), "pkg.txt");
  const ok = run(["package", "--base", r.base, "--head", r.head, "--out", out, "--repo", r.dir]);
  assert.equal(ok.status, 0, ok.stderr);
  const pkg = fs.readFileSync(out, "utf8");
  assert.match(pkg, / change\n/);
  assert.match(pkg, /src\/provider\.ts\s+\| 50 \+/);
  assert.match(pkg, /^\+v := items\[0\]$/m);
  assert.match(pkg, /^ line 20$/m, "-U10 keeps 10 context lines after line 10");
  assert.equal(run(["package", "--base", r.head, "--head", r.head, "--out", out, "--repo", r.dir]).status, 3);
  assert.equal(run(["package", "--base", r.head, "--head", r.base, "--out", out, "--repo", r.dir]).status, 3);
});

test("bugbot fixtures pass through union; bugbot location on an added line counts as quoted", () => {
  const r = repo();
  const expected = {
    "xml-no-bugs.txt": "PASS",
    "xml-high.txt": "BLOCK",
    "verdict-bold-pass.txt": "PASS",
    "verdict-heading-block.txt": "BLOCK",
    "template-echo-table.txt": "BLOCK",
    "verdict-status-pass.txt": "PASS",
    "prose-no-bugs.txt": "PASS",
    "unparsed.txt": "BLOCK",
    "table-medium.txt": "PASS",
  };
  for (const [file, want] of Object.entries(expected)) {
    const v = union(r, { "andx-review-s-bugbot.txt": fs.readFileSync(join(FIXTURES, file), "utf8") });
    assert.equal(v.status, want, file);
  }
  const v = union(r, { "bugbot": fs.readFileSync(join(FIXTURES, "xml-high.txt"), "utf8") });
  assert.deepEqual(v.blockers.map((f) => [f.location, f.severity]), [["src/provider.ts:42", "high"]]);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]), [["src/a.ts:1", "wrong-base"]]);
  assert.deepEqual(union(r, { "bugbot": "nonsense" }).unparsed, ["bugbot"]);
});

test("an unquoted High from another reviewer is demoted, and its BLOCK fails closed", () => {
  const v = union(repo(), { "audit": verdict("BLOCK", "[HIGH] src/x.go:10 — nil deref") });
  assert.deepEqual(v.advisory.map((f) => [f.severity, f.demoted_from]), [["medium", "high"]]);
  assert.deepEqual([v.status, v.unparsed], ["BLOCK", ["audit"]]);
});

test("union dedups across aliases, keeps quoted highs, drops wrong-base by exact path", () => {
  const r = repo();
  const v = union(r, {
    "andx-review-s-bugbot.txt": verdict("BLOCK", "[HIGH] src/x.go:10 — nil deref on empty items `items[0]`"),
    "andx-review-s-ponytail-review.txt": "## VERDICT\nstatus: PASS\nadvisory:\n  - [MEDIUM] src/x.go:12 — items slice unchecked\n  - [MEDIUM] x.go:10 — basename only\n",
    "andx-review-s-security-review.txt": "## VERDICT\nstatus: PASS\nsecrets_scan: RAN\nadvisory:\n  - [MEDIUM] old.go:1 — stale code\n",
    "notes.txt": verdict("BLOCK", "[HIGH] src/x.go:10 — ignored file"),
  });
  assert.equal(v.status, "BLOCK");
  assert.equal(v.secrets_scan, "RAN");
  assert.deepEqual(v.blockers.map((f) => [f.location, f.severity, f.reviewers]), [["src/x.go:10", "high", ["bugbot", "ponytail"]]]);
  assert.deepEqual(v.advisory, []);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]), [["x.go:10", "wrong-base"], ["old.go:1", "wrong-base"]]);
});

test("diff paths: spaces, non-ASCII, deleted files, removed lines, lines outside the hunks", () => {
  const v = union(repo(), {
    "bugbot": `<answer>${bug("src/my file.ts", 1, "spaced path")}${bug("src/ünï.ts", 1, "unicode path")}</answer>`,
    "security": verdict("BLOCK", "[HIGH] gone.go:1 — removed auth check `check(auth)` (auth-removed)", "[MEDIUM] src/x.go:29 — far from the hunk",
      "[HIGH] src/x.go — whole-file quote `items[0]` (whole-file)"),
  });
  assert.deepEqual(v.blockers.map((f) => f.location).sort(), ["gone.go:1", "src/my file.ts:1", "src/x.go", "src/ünï.ts:1"]);
  assert.deepEqual(v.advisory.map((f) => f.location), ["src/x.go:29"]);
  assert.deepEqual([v.dropped, v.unparsed], [[], []]);
});

test("--slug is required and reads only that run's reports", () => {
  const r = repo();
  const v = union(r, {
    "andx-review-s-bugbot.txt": "## VERDICT\nstatus: PASS\n",
    "andx-review-s-x-spec.txt": "nonsense",
    "bugbot.txt": "nonsense",
  });
  assert.deepEqual([v.status, v.unparsed], ["PASS", []]);
  assert.equal(run(["union", "--base", r.base, "--head", r.head, "--reports", tmp(), "--repo", r.dir]).status, 2);
});

test("a/ diff prefix stripped once; a reviewer's b/ prefix is tolerated", () => {
  const v = union(repo(), { "bugbot": verdict("BLOCK", "[HIGH] a/deep.go:5 — deep bug", "[HIGH] b/src/x.go:10 — prefixed by reviewer") });
  assert.deepEqual(v.blockers.map((f) => f.location), ["a/deep.go:5", "b/src/x.go:10"]);
});

test("quoted C-style header path", { skip: process.platform === "win32" && "no double quote in Windows file names" }, () => {
  const v = union(repo(), { "bugbot": `<answer>${bug('src/q"x.go', 1, "quoted path")}</answer>` });
  assert.deepEqual([v.blockers.map((f) => f.location), v.unparsed], [['src/q"x.go:1'], []]);
});

test("bugbot location counts as quoted only when its start line is added", () => {
  const range = '<bug><title>wide</title><file>src/x.go</file><start_line>5</start_line><end_line>15</end_line><severity>high</severity><description>d</description></bug>';
  const v = union(repo(), { "bugbot": `<answer>${range}</answer>` });
  assert.deepEqual([v.blockers, v.advisory.map((f) => f.demoted_from), v.unparsed], [[], ["high"], ["bugbot"]]);
});

test("distinct security fingerprints never merge; decisions apply per finding", () => {
  const r = repo();
  const refuters = join(tmp(), "ref.json");
  fs.writeFileSync(refuters, JSON.stringify([
    { id: "init-trust", decision: "rejected", reason: "trusted" },
    { id: "token-leak", decision: "confirmed", reason: "logged" },
    { id: "downgraded", decision: "confirmed", severity: "medium", reason: "limited" },
  ]));
  const v = union(r, { "security": verdict("BLOCK", "[HIGH] src/provider.ts:42 — init trusts caller token (init-trust)", "[HIGH] src/provider.ts:44 — leaks token (token-leak)") }, ["--refuters", refuters]);
  assert.deepEqual([v.status, v.blockers.map((f) => f.id), v.rejected.map((f) => f.id), v.unparsed], ["BLOCK", ["token-leak"], ["init-trust"], []]);
  const d = union(r, { "security": verdict("BLOCK", "[HIGH] src/provider.ts:42 — narrow leak (downgraded)") }, ["--refuters", refuters]);
  assert.deepEqual([d.status, d.advisory.map((f) => [f.id, f.severity]), d.unparsed], ["PASS", [["downgraded", "medium"]], []]);
});

test("refuter decisions: rejection removes only the security member; refuted BLOCK is accounted for", () => {
  const r = repo();
  const refuters = join(tmp(), "ref.json");
  fs.writeFileSync(refuters, JSON.stringify([
    { fingerprint: "init-trust", decision: "rejected", reason: "caller is trusted" },
    { id: "index-panic", decision: "needs_validation", reason: "depends on input", blockers: ["input shape"] },
    { id: "token-leak", decision: "confirmed", reason: "logged" },
  ]));
  const v = union(r, {
    "bugbot": verdict("BLOCK", "[HIGH] src/provider.ts:42 — init trusts caller unchecked"),
    "security": verdict("BLOCK", "[HIGH] src/provider.ts:42 — init trusts caller (init-trust)", "[HIGH] src/x.go:10 — index panic (index-panic)", "[HIGH] src/provider.ts:45 — leaks token (token-leak)"),
  }, ["--refuters", refuters]);
  assert.deepEqual(v.rejected.map((f) => [f.id, f.status, f.severity, f.reason, f.reviewers]), [["init-trust", "rejected", undefined, "caller is trusted", ["security"]]]);
  assert.deepEqual(v.advisory.map((f) => [f.id, f.status, f.severity, f.blockers]), [["index-panic", "needs_validation", undefined, ["input shape"]]]);
  assert.deepEqual(v.blockers.map((f) => [f.id, f.severity, f.reviewers]).sort(), [["provider-ts-init-trusts-caller-unchecked", "high", ["bugbot"]], ["token-leak", "high", ["security"]]]);

  const only = union(r, { "security": verdict("BLOCK", "[HIGH] src/provider.ts:42 — init trusts caller (init-trust)") }, ["--refuters", refuters]);
  assert.deepEqual([only.status, only.unparsed], ["PASS", []]);
  const ghost = union(r, { "security": verdict("BLOCK", "[HIGH] nowhere.go:1 — ghost (ghost)") });
  assert.deepEqual([ghost.status, ghost.unparsed], ["BLOCK", ["security"]]);
});

test("round 2: confirmations, same-reviewer re-raise, unreported reviewers, changed lines only, carry dedup", () => {
  const r = repo();
  const prior = join(tmp(), "prior.json");
  fs.writeFileSync(prior, JSON.stringify({
    status: "BLOCK", round: 1, base_sha: r.base, head_sha: r.head,
    blockers: [
      { id: "provider-race", status: "confirmed", severity: "high", location: "src/provider.ts:42", finding: "provider init race", reviewers: ["bugbot"] },
      { id: "x-panic", status: "confirmed", severity: "high", location: "src/x.go:10", finding: "index out of range panic", reviewers: ["bugbot"] },
      { id: "spec-gap", status: "confirmed", severity: "high", location: "src/x.go:25", finding: "readme not updated", reviewers: ["spec"] },
      { id: "orphan", status: "confirmed", severity: "high", location: "src/x.go:28", finding: "no reviewer recorded" },
    ],
    advisory: [{ id: "x-go-general-concern", status: "confirmed", severity: "medium", location: "src/x.go", finding: "general concern", reviewers: ["bugbot"] }],
    deferred: [], fixed: [], rejected: [{ id: "old-reject", status: "rejected", location: "src/x.go:3", finding: "f", reviewers: ["security"] }],
  }));
  const fix = commit(r.dir, { "src/x.go": lines(30, (i) => (i === 10 ? "if len(items) > 0 { v = items[0] }" : `line ${i}`)) }, "fix");
  const v = union({ ...r, base: r.head, head: fix }, {
    "bugbot": "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] src/provider.ts:30 — still racy at another spot\nadvisory:\n  - [MEDIUM] src/x.go — general concern\n",
    "security": verdict("BLOCK",
      "[HIGH] src/x.go:10 — guard misses nil `len(items) > 0` (nil-guard)",
      "[MEDIUM] src/x.go:20 — old line issue `line 20` (old-line)",
      "[HIGH] src/x.go:3 — re-raised (old-reject)"),
  }, ["--round", "2", "--prior", prior]);
  assert.equal(v.base_sha, r.base);
  assert.deepEqual(v.blockers.map((f) => [f.id, f.location]).sort(), [["nil-guard", "src/x.go:10"], ["orphan", "src/x.go:28"], ["provider-race", "src/provider.ts:30"], ["spec-gap", "src/x.go:25"]]);
  assert.deepEqual(v.fixed.map((f) => [f.id, f.resolution]), [["x-panic", "fixed"]]);
  assert.deepEqual(v.advisory.map((f) => f.id), ["x-go-general-concern"]);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]).sort(), [["src/x.go:20", "round-scope"], ["src/x.go:3", "prior-rejected"]]);
  assert.deepEqual(v.rejected.map((f) => f.id), ["old-reject"]);
  assert.deepEqual(v.unparsed, []);
});

test("artifact writes a valid v2 file and refuses an invalid verdict", () => {
  const r = repo();
  const dir = tmp();
  const file = join(dir, "v.json");
  const v = union(r, { "bugbot": "## VERDICT\nstatus: PASS\nadvisory:\n  - [LOW] src/x.go:10 — naming\n" });
  fs.writeFileSync(file, JSON.stringify(v));
  const out = join(dir, "a.json");
  const ok = run(["artifact", "--verdict", file, "--plan", ".cursor/plans/p.plan.md", "--out", out]);
  assert.equal(ok.status, 0, ok.stderr);
  const a = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual([a.schema_version, a.verdict, a.target_branch, a.findings[0].resolution], [2, "PASS", "main", "deferred"]);
  const check = spawnSync(process.execPath, [VALIDATOR, out, "--head", r.head, "--base", r.base], { encoding: "utf8" });
  assert.equal(check.stdout.trim(), "TRUSTED");

  fs.writeFileSync(file, JSON.stringify({ ...v, blockers: [{ id: "x", status: "confirmed", severity: "high", location: "a:1", finding: "f" }] }));
  const bad = join(dir, "bad.json");
  const r2 = run(["artifact", "--verdict", file, "--plan", "p", "--out", bad]);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /INVALID[\s\S]*PASS with unfixed high/);
  assert.equal(fs.existsSync(bad), false);
});
