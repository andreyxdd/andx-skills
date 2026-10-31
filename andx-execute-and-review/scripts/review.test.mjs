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
    fs.mkdirSync(dirname(join(repo, p)), { recursive: true });
    fs.writeFileSync(join(repo, p), body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD");
}

const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

// base: src/x.go and old.go; head: rewrites src/x.go line 10 and adds src/provider.ts
function repo() {
  const dir = tmp();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  const base = commit(dir, { "src/x.go": lines(30, (i) => `line ${i}`), "old.go": "old\n" }, "base");
  const head = commit(dir, {
    "src/x.go": lines(30, (i) => (i === 10 ? "v := items[0]" : `line ${i}`)),
    "src/provider.ts": lines(50, (i) => (i === 42 ? "init(provider)" : `p ${i}`)),
  }, "change");
  return { dir, base, head };
}

function union(r, reports, extra = []) {
  const dir = tmp();
  for (const [name, body] of Object.entries(reports)) fs.writeFileSync(join(dir, name), body);
  const out = run(["union", "--base", r.base, "--head", r.head, "--reports", dir, "--repo", r.dir, ...extra]);
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test("package writes commits, stat and diff; refuses empty or unrelated ranges", () => {
  const r = repo();
  const out = join(tmp(), "pkg.txt");
  const ok = run(["package", "--base", r.base, "--head", r.head, "--out", out, "--repo", r.dir]);
  assert.equal(ok.status, 0, ok.stderr);
  const pkg = fs.readFileSync(out, "utf8");
  assert.match(pkg, / change\n/);
  assert.match(pkg, /src\/provider\.ts \| 50 \+/);
  assert.match(pkg, /^\+v := items\[0\]$/m);
  assert.match(pkg, /^ line 20$/m, "-U10 keeps 10 context lines after line 10");
  assert.equal(run(["package", "--base", r.head, "--head", r.head, "--out", out, "--repo", r.dir]).status, 3);
  assert.equal(run(["package", "--base", r.head, "--head", r.base, "--out", out, "--repo", r.dir]).status, 3);
});

test("bugbot fixtures pass through union; unquoted highs are demoted", () => {
  const r = repo();
  const expected = {
    "xml-no-bugs.txt": "PASS",
    "xml-high.txt": "PASS",
    "verdict-bold-pass.txt": "PASS",
    "verdict-heading-block.txt": "PASS",
    "template-echo-table.txt": "PASS",
    "verdict-status-pass.txt": "PASS",
    "prose-no-bugs.txt": "PASS",
    "unparsed.txt": "BLOCK",
    "table-medium.txt": "PASS",
  };
  for (const [file, want] of Object.entries(expected)) {
    const v = union(r, { "andx-review-s-bugbot.txt": fs.readFileSync(join(FIXTURES, file), "utf8") });
    assert.equal(v.status, want, file);
  }
  const v = union(r, { "bugbot.txt": fs.readFileSync(join(FIXTURES, "xml-high.txt"), "utf8") });
  assert.deepEqual(v.advisory.map((f) => [f.location, f.severity, f.demoted_from]), [["src/provider.ts:42", "medium", "high"]]);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]), [["src/a.ts:1", "wrong-base"]]);
  assert.deepEqual(union(r, { "bugbot.txt": "nonsense" }).unparsed, ["bugbot"]);
});

test("union dedups across aliases, keeps quoted highs, drops wrong-base", () => {
  const r = repo();
  const v = union(r, {
    "andx-review-s-bugbot.txt": "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] src/x.go:10 — nil deref on empty items `items[0]`\n",
    "andx-review-s-ponytail-review.txt": "## VERDICT\nstatus: PASS\nadvisory:\n  - [MEDIUM] x.go:12 — items slice unchecked\n",
    "andx-review-s-security-review.txt": "## VERDICT\nstatus: PASS\nsecrets_scan: RAN\nadvisory:\n  - [MEDIUM] old.go:1 — stale code\n",
    "notes.txt": "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] src/x.go:10 — ignored file\n",
  });
  assert.equal(v.status, "BLOCK");
  assert.equal(v.secrets_scan, "RAN");
  assert.deepEqual(v.blockers.map((f) => [f.location, f.severity, f.reviewers]), [["src/x.go:10", "high", ["bugbot", "ponytail"]]]);
  assert.deepEqual(v.advisory, []);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]), [["old.go:1", "wrong-base"]]);
});

test("refuter decisions: rejected leaves, needs_validation goes advisory, confirmed skips the quote rule", () => {
  const r = repo();
  const sec = "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] src/provider.ts:42 — init trusts caller (init-trust)\n  - [HIGH] src/x.go:10 — index panic (index-panic)\n  - [HIGH] src/provider.ts:45 — leaks token (token-leak)\n";
  const refuters = join(tmp(), "ref.json");
  fs.writeFileSync(refuters, JSON.stringify([
    { fingerprint: "init-trust", decision: "rejected", reason: "caller is trusted" },
    { id: "index-panic", decision: "needs_validation", reason: "depends on input", blockers: ["input shape"] },
    { id: "token-leak", decision: "confirmed", reason: "logged" },
  ]));
  const v = union(r, { "security.txt": sec }, ["--refuters", refuters]);
  assert.deepEqual(v.rejected.map((f) => [f.id, f.status, f.severity, f.reason]), [["init-trust", "rejected", undefined, "caller is trusted"]]);
  assert.deepEqual(v.advisory.map((f) => [f.id, f.status, f.severity, f.blockers]), [["index-panic", "needs_validation", undefined, ["input shape"]]]);
  assert.deepEqual(v.blockers.map((f) => [f.id, f.severity, f.finding]), [["token-leak", "high", "leaks token"]]);
});

test("round 2 keeps prior-blocker confirmations and new findings on changed lines only", () => {
  const r = repo();
  const prior = join(tmp(), "prior.json");
  fs.writeFileSync(prior, JSON.stringify({
    status: "BLOCK", round: 1, base_sha: r.base, head_sha: r.head,
    blockers: [
      { id: "provider-race", status: "confirmed", severity: "high", location: "src/provider.ts:42", finding: "provider init race", reviewers: ["bugbot"] },
      { id: "x-panic", status: "confirmed", severity: "high", location: "src/x.go:10", finding: "index out of range panic", reviewers: ["bugbot"] },
    ],
    advisory: [], deferred: [], fixed: [], rejected: [{ id: "old-reject", status: "rejected", location: "src/x.go:3", finding: "f", reviewers: ["security"] }],
  }));
  const fix = commit(r.dir, { "src/x.go": lines(30, (i) => (i === 10 ? "if len(items) > 0 { v = items[0] }" : `line ${i}`)) }, "fix");
  const v = union({ ...r, base: r.head, head: fix }, {
    "bugbot.txt": [
      "## VERDICT", "status: BLOCK", "blockers:",
      "  - [HIGH] src/provider.ts:43 — provider init still races",
      "  - [HIGH] src/x.go:20 — old line issue `line 20`",
      "  - [HIGH] src/x.go:10 — guard misses nil `len(items) > 0`",
    ].join("\n"),
    "security.txt": "## VERDICT\nstatus: BLOCK\nblockers:\n  - [HIGH] src/x.go:3 — re-raised (old-reject)\n",
  }, ["--round", "2", "--prior", prior]);
  assert.equal(v.base_sha, r.base);
  assert.deepEqual(v.blockers.map((f) => [f.id, f.location]).sort(), [["provider-race", "src/provider.ts:43"], ["x-go-guard-misses-nil-len-items-0", "src/x.go:10"]].sort());
  assert.deepEqual(v.fixed.map((f) => [f.id, f.resolution]), [["x-panic", "fixed"]]);
  assert.deepEqual(v.dropped.map((f) => [f.location, f.reason]).sort(), [["src/x.go:20", "round-scope"], ["src/x.go:3", "prior-rejected"]]);
  assert.deepEqual(v.rejected.map((f) => f.id), ["old-reject"]);
});

test("artifact writes a valid v2 file and refuses an invalid verdict", () => {
  const r = repo();
  const dir = tmp();
  const verdict = join(dir, "v.json");
  const v = union(r, { "bugbot.txt": "## VERDICT\nstatus: PASS\nadvisory:\n  - [LOW] src/x.go:10 — naming\n" });
  fs.writeFileSync(verdict, JSON.stringify(v));
  const out = join(dir, "a.json");
  const ok = run(["artifact", "--verdict", verdict, "--plan", ".cursor/plans/p.plan.md", "--out", out]);
  assert.equal(ok.status, 0, ok.stderr);
  const a = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual([a.schema_version, a.verdict, a.target_branch, a.findings[0].resolution], [2, "PASS", "main", "deferred"]);
  const check = spawnSync(process.execPath, [VALIDATOR, out, "--head", r.head, "--base", r.base], { encoding: "utf8" });
  assert.equal(check.stdout.trim(), "TRUSTED");

  fs.writeFileSync(verdict, JSON.stringify({ ...v, blockers: [{ id: "x", status: "confirmed", severity: "high", location: "a:1", finding: "f" }] }));
  const bad = join(dir, "bad.json");
  const r2 = run(["artifact", "--verdict", verdict, "--plan", "p", "--out", bad]);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /INVALID[\s\S]*PASS with unfixed high/);
  assert.equal(fs.existsSync(bad), false);
});
