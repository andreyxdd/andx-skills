import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgers, newStamp, runNames } from "./run.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "run.mjs");
let repo;

const run = (args, cwd = repo) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", cwd], { encoding: "utf8" });
const ok = (...a) => {
  const r = run(a);
  assert.equal(r.status, 0, `${a.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
};
const vars = (out) => Object.fromEntries(out.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const ledger = (slug) => JSON.parse(fs.readFileSync(join(repo, ".worktrees", ".andx-run", `${slug}.json`), "utf8"));
const git = (...a) => spawnSync("git", a, { cwd: repo, encoding: "utf8" });

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "run-")));
  git("init", "-q", "-b", "main");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test("naming: local stamp, plain run, wave, and wave step", () => {
  assert.equal(newStamp(new Date(2026, 10, 1, 6, 27, 8)), "20261101-062708");
  const r = join("/r", "proj");
  assert.deepEqual(runNames({ root: r, slug: "feat", stamp: "20261101-062708" }), {
    EXEC_BRANCH: "andx/exec-feat-20261101-062708", WORKTREE_DIR: join(r, ".worktrees", "exec-feat-20261101-062708"),
  });
  assert.equal(runNames({ root: r, slug: "feat", wave: "2", stamp: "20261101-062708" }).EXEC_BRANCH, "andx/exec-feat-w2-20261101-062708");
  assert.deepEqual(runNames({ root: r, slug: "feat", wave: "2", step: "step-8", stamp: "20261101-062708" }), {
    EXEC_BRANCH: "andx/exec-feat-w2-step-8-20261101-062708", WORKTREE_DIR: join(r, ".worktrees", "exec-feat-w2-step-8-20261101-062708"),
  });
});

test("ledgers lists run ledgers, skipping dotfiles and other files", () => {
  assert.deepEqual(ledgers(repo), []);
  const dir = join(repo, ".worktrees", ".andx-run");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["a.json", ".a.json.1.tmp", "notes.txt", "b.json"]) fs.writeFileSync(join(dir, f), "{}");
  assert.deepEqual(ledgers(repo).sort(), [join(dir, "a.json"), join(dir, "b.json")]);
});

test("start derives run variables and writes the ledger", () => {
  const v = vars(ok("start", "--slug", "feat", "--mode", "review"));
  assert.match(v.STAMP, /^\d{8}-\d{6}$/);
  assert.deepEqual(v, {
    REPO_ROOT: repo,
    TARGET_BRANCH: "main",
    STAMP: v.STAMP,
    EXEC_BRANCH: `andx/exec-feat-${v.STAMP}`,
    WORKTREE_DIR: join(repo, ".worktrees", `exec-feat-${v.STAMP}`),
    SHIP_ID: `andx/exec-feat-${v.STAMP}`,
  });
  const l = ledger("feat");
  assert.deepEqual(
    { slug: l.slug, mode: l.mode, ship_id: l.ship_id, phase: l.phase, phases: l.phases, continues: l.continues, terminal: l.terminal, landed: l.landed },
    { slug: "feat", mode: "review", ship_id: v.SHIP_ID, phase: null, phases: [], continues: 0, terminal: null, landed: null },
  );
  assert.deepEqual(l.required_phases, ["A", "C", "D", "F"]);
  assert.deepEqual(l.vars, v);
  assert.deepEqual(fs.readdirSync(join(repo, ".worktrees", ".andx-run")), ["feat.json"]);
});

test("start from a linked worktree resolves the primary checkout", () => {
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  const wt = join(repo, ".worktrees", "exec-x");
  git("worktree", "add", "-q", "-b", "side", wt);
  const v = vars(run(["start", "--slug", "feat", "--mode", "deploy"], wt).stdout);
  assert.equal(v.REPO_ROOT, repo);
  assert.equal(v.TARGET_BRANCH, "main");
  assert.deepEqual(ledger("feat").required_phases, ["A", "F", "A′", "B", "C", "D"]);
});

test("start rejects unsafe slugs and unknown modes", () => {
  for (const slug of ["../x", "Feat", "a".repeat(41), ""]) assert.equal(run(["start", "--slug", slug, "--mode", "review"]).status, 2, slug);
  assert.equal(run(["start", "--slug", "feat", "--mode", "nope"]).status, 2);
  assert.equal(fs.existsSync(join(repo, ".worktrees", ".andx-run", "feat.json")), false);
});

test("end DONE is refused until every required phase is recorded", () => {
  ok("start", "--slug", "feat", "--mode", "review");
  ok("phase", "feat", "A");
  ok("phase", "feat", "ship-wait");
  const end = ["end", "feat", "--terminal", "DONE", "--merged", "PASS", "--pushed", "NOT_REQUESTED", "--mr", "-", "--deployed", "NOT_REQUESTED"];
  const r = run(end);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /missing required phases: C, D, F/);
  assert.equal(ledger("feat").terminal, null);
  for (const p of ["C", "D", "F", "C"]) ok("phase", "feat", p);
  assert.deepEqual(ledger("feat").phases, ["A", "ship-wait", "C", "D", "F"]);
  assert.equal(ledger("feat").phase, "C");
  assert.equal(ok(...end), "MERGED PASS | PUSHED NOT_REQUESTED | MR - | DEPLOYED NOT_REQUESTED\n");
  assert.equal(ledger("feat").terminal, "DONE");
});

test("review-deploy DONE needs the review pass R and the landing F, not just deploy's C and D", () => {
  ok("start", "--slug", "feat", "--mode", "review-deploy");
  assert.deepEqual(ledger("feat").required_phases, ["A", "R", "F", "A′", "B", "C", "D"]);
  for (const p of ["A", "A′", "B", "C", "D"]) ok("phase", "feat", p);
  const end = ["end", "feat", "--terminal", "DONE"];
  assert.match(run(end).stderr, /missing required phases: R, F/);
  ok("phase", "feat", "R");
  const r = run(end);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /missing required phases: F$/m);
  ok("phase", "feat", "F");
  ok(...end);
  assert.equal(ledger("feat").terminal, "DONE");
});

test("phase records an ASCII apostrophe as the prime in A′", () => {
  ok("start", "--slug", "feat", "--mode", "deploy");
  assert.equal(ok("phase", "feat", "A'"), "PHASE feat A′\n");
  assert.deepEqual(ledger("feat").phases, ["A′"]);
  assert.equal(ledger("feat").phase, "A′");
});

test("end DONE on a legacy ledger uses the mode's required phases", () => {
  const dir = join(repo, ".worktrees", ".andx-run");
  fs.mkdirSync(dir, { recursive: true });
  const legacy = (slug, mode) => fs.writeFileSync(join(dir, `${slug}.json`), JSON.stringify({ slug, mode, phase: "C", continues: 0, terminal: null }));
  legacy("old", "review");
  const r = run(["end", "old", "--terminal", "DONE"]);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /missing required phases: A, C, D, F/);
  legacy("odd", "custom");
  assert.equal(run(["end", "odd", "--terminal", "DONE"]).status, 5);
  assert.equal(ledger("odd").terminal, null);
  assert.equal(run(["end", "odd", "--terminal", "ABORTED"]).status, 0);
});

test("end non-DONE terminals need no phases and validate statuses", () => {
  ok("start", "--slug", "feat", "--mode", "review-mr");
  assert.equal(run(["end", "feat", "--terminal", "FINISHED"]).status, 2);
  assert.equal(run(["end", "feat", "--terminal", "ABORTED", "--merged", "MAYBE"]).status, 2);
  assert.equal(
    ok("end", "feat", "--terminal", "AWAITING_USER", "--merged", "-", "--pushed", "PASS", "--mr", "https://h/mr/1"),
    "MERGED - | PUSHED PASS | MR https://h/mr/1 | DEPLOYED NOT_REQUESTED\n",
  );
  assert.equal(ledger("feat").terminal, "AWAITING_USER");
});

test("phase and end set the wt list marker on every run branch; DONE clears it", () => {
  const marker = (b) => {
    const r = git("config", "--get", `worktrunk.state.${b}.marker`);
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  };
  const v = vars(ok("start", "--slug", "feat", "--mode", "execute"));
  const wave = "andx/exec-feat-w1-step-2-20261101-062708";
  const file = join(repo, ".worktrees", ".andx-run", "feat.json");
  fs.writeFileSync(file, JSON.stringify({ ...ledger("feat"), worktrees: { w: { EXEC_BRANCH: wave } } }));
  ok("phase", "feat", "A");
  for (const b of [v.EXEC_BRANCH, wave]) assert.equal(marker(b)?.marker, "🤖", b);
  assert.ok(Math.abs(marker(wave).set_at - Date.now() / 1000) < 60, "set_at is epoch seconds");
  ok("end", "feat", "--terminal", "AWAITING_USER");
  assert.equal(marker(wave).marker, "💬");
  ok("end", "feat", "--terminal", "ESCALATED");
  assert.equal(marker(wave).marker, "❌");
  ok("phase", "feat", "F");
  ok("end", "feat", "--terminal", "DONE");
  assert.equal(marker(v.EXEC_BRANCH), null);
  assert.equal(marker(wave), null);
});

test("landed records the sha; show prints the ledger", () => {
  ok("start", "--slug", "feat", "--mode", "execute");
  assert.equal(run(["landed", "feat", "not-a-sha"]).status, 2);
  ok("landed", "feat", "0123abcd");
  assert.equal(ledger("feat").landed, "0123abcd");
  assert.deepEqual(JSON.parse(ok("show", "feat")), ledger("feat"));
  assert.equal(run(["show", "nope"]).status, 2);
});
