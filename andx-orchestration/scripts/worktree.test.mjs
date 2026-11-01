import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path, { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentPath } from "./worktree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "worktree.mjs");
const RUN = join(here, "run.mjs");
let repo;

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}
const git = (...a) => run("git", a);
const commit = (cwd, m) => run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", m], cwd);
const wt = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: repo, encoding: "utf8" });
const sweep = (...a) => run(process.execPath, [SCRIPT, "sweep", ...a]);
const vars = (out) => Object.fromEntries(out.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ledgerOf = (slug) => JSON.parse(fs.readFileSync(join(repo, ".worktrees", ".andx-run", `${slug}.json`), "utf8"));

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "worktree-")));
  git("init", "-q", "-b", "main");
  commit(repo, "init");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test("create without a ledger: adds the ignore line once, makes the worktree on a new branch", () => {
  const r = wt("create", "--slug", "feat", "--stamp", "20261101-062708");
  assert.equal(r.status, 0, r.stderr);
  const v = vars(r.stdout);
  assert.equal(v.EXEC_BRANCH, "andx/exec-feat-20261101-062708");
  assert.equal(v.WORKTREE_DIR, join(repo, ".worktrees", "exec-feat-20261101-062708"));
  assert.equal(v.TARGET_BRANCH, "main");
  assert.match(r.stdout, /^IGNORE added \.worktrees\/ to .*exclude$/m);
  assert.match(fs.readFileSync(join(repo, ".git", "info", "exclude"), "utf8"), /^\.worktrees\/$/m);
  assert.equal(run("git", ["branch", "--show-current"], v.WORKTREE_DIR).trim(), v.EXEC_BRANCH);
  assert.equal(git("branch", "--show-current").trim(), "main");
  assert.equal(git("status", "--porcelain"), "");

  const again = wt("create", "--slug", "other");
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /IGNORE/);
});

test("create reuses the run ledger names and records worktree and red baseline", () => {
  const start = vars(run(process.execPath, [RUN, "start", "--slug", "feat", "--mode", "execute"]));
  const r = wt("create", "--slug", "feat", "--baseline", "exit 1");
  assert.equal(r.status, 0, r.stderr);
  const v = vars(r.stdout);
  assert.equal(v.EXEC_BRANCH, start.EXEC_BRANCH);
  assert.equal(v.WORKTREE_DIR, start.WORKTREE_DIR);
  assert.match(r.stdout, /^BASELINE exit=1 red$/m);
  const name = path.basename(start.WORKTREE_DIR);
  assert.deepEqual(ledgerOf("feat").worktrees[name], {
    EXEC_BRANCH: start.EXEC_BRANCH, WORKTREE_DIR: start.WORKTREE_DIR, TARGET_BRANCH: "main",
    baseline: { cmd: "exit 1", exit: 1, red: true },
  });
  assert.equal(ledgerOf("feat").mode, "execute");
});

test("create wave step names the worktree with wave and step", () => {
  const r = wt("create", "--slug", "feat", "--wave", "2", "--step", "step-8", "--stamp", "20261101-062708");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(vars(r.stdout).EXEC_BRANCH, "andx/exec-feat-w2-step-8-20261101-062708");
  assert.ok(fs.existsSync(join(repo, ".worktrees", "exec-feat-w2-step-8-20261101-062708")));
});

test("create runs the primary checkout setup and quotes each exit code", () => {
  fs.mkdirSync(join(repo, ".cursor"));
  const node = JSON.stringify(process.execPath);
  fs.writeFileSync(join(repo, ".cursor", "worktrees.json"), JSON.stringify({
    "setup-worktree": [`${node} -e "require('fs').writeFileSync('root.txt', process.env.ROOT_WORKTREE_PATH)"`, `${node} -e "process.exit(3)"`],
  }));
  const r = wt("create", "--slug", "feat");
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const v = vars(r.stdout);
  assert.equal(fs.readFileSync(join(v.WORKTREE_DIR, "root.txt"), "utf8"), repo);
  assert.match(r.stdout, /^SETUP exit=0 /m);
  assert.match(r.stdout, /^SETUP exit=3 /m);
});

test("create stops when git worktree add fails: no checkout fallback", () => {
  assert.equal(wt("create", "--slug", "feat", "--stamp", "20261101-062708").status, 0);
  const r = wt("create", "--slug", "feat", "--stamp", "20261101-062708");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no checkout fallback/);
  assert.equal(git("branch", "--show-current").trim(), "main");
});

test("remove prints the list before and after and deletes the merged branch", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  const r = wt("remove", "feat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [before, after] = r.stdout.split("# git worktree list (after)");
  assert.ok(before.includes(v.WORKTREE_DIR), before);
  assert.ok(!after.includes(v.WORKTREE_DIR), after);
  assert.doesNotMatch(git("branch"), /exec-feat/);
});

test("remove keeps a dirty worktree and an unmerged branch", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  fs.writeFileSync(join(v.WORKTREE_DIR, "x.txt"), "x");
  let r = wt("remove", "feat");
  assert.equal(r.status, 1);
  assert.ok(fs.existsSync(v.WORKTREE_DIR));
  fs.rmSync(join(v.WORKTREE_DIR, "x.txt"));
  commit(v.WORKTREE_DIR, "wip");
  r = wt("remove", "feat");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /manual: git branch -D/);
  assert.match(git("branch"), /exec-feat/);
});

test("remove with nothing to remove exits 1", () => {
  assert.equal(wt("remove", "nope").status, 1);
});

test("help prints usage, including after sweep", () => {
  for (const a of [["--help"], ["sweep", "--help"]]) {
    const r = wt(...a);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /sweep \[--apply\]/);
  }
});

function sweepRepo() {
  for (const n of ["merged", "dirty", "unmerged"]) git("worktree", "add", "-q", "-b", `wt/exec-${n}`, `.worktrees/exec-${n}`, "main");
  commit(join(repo, ".worktrees", "exec-unmerged"), "wip");
  fs.writeFileSync(join(repo, ".worktrees", "exec-dirty", "x.txt"), "x");
}

test("sweep apply removes only clean merged worktrees", () => {
  sweepRepo();
  const out = sweep("--apply", repo);
  const list = git("worktree", "list");
  assert.doesNotMatch(list, /exec-merged/, out);
  assert.match(list, /exec-dirty/);
  assert.match(list, /exec-unmerged/);
  assert.match(out, /^target=main removed=1 kept=2 apply=1$/m);
  assert.doesNotMatch(git("branch"), /wt\/exec-merged/);
});

test("sweep dry run removes nothing and prints actions", () => {
  sweepRepo();
  const out = sweep(repo);
  assert.match(git("worktree", "list"), /exec-merged/);
  assert.match(out, /^remove {2}clean {2}merged {3}wt\/exec-merged \S.*exec-merged$/m);
  assert.match(out, /^keep {4}dirty  merged {3}wt\/exec-dirty \S.*exec-dirty$/m);
  assert.match(out, /^keep {4}clean  unmerged wt\/exec-unmerged \S.*exec-unmerged$/m);
  assert.match(out, /^ {8}manual: git worktree remove --force '.*exec-dirty' && git branch -D 'wt\/exec-dirty' {2}# only after you confirm$/m);
  assert.match(out, /^target=main removed=0 kept=2 apply=0$/m);
});

test("sweep matches agent worktree paths across separators and drive-letter case", () => {
  const W = "C:\\Users\\Me\\proj";
  assert.equal(agentPath("c:/users/me/proj/.worktrees/feature", W, path.win32), true);
  assert.equal(agentPath("C:\\Users\\Me\\proj\\.worktrees\\feature", W, path.win32), true);
  assert.equal(agentPath("C:\\Users\\Me\\proj\\.worktreesX\\feature", W, path.win32), false);
  assert.equal(agentPath("D:\\elsewhere\\feature", W, path.win32), false);
  assert.equal(agentPath("D:\\tmp\\Review-1", W, path.win32), true);
  assert.equal(agentPath("/r/proj/.worktrees/a", "/r/proj", path.posix), true);
  assert.equal(agentPath("/r/proj/.worktreesX/a", "/r/proj", path.posix), false);
  assert.equal(agentPath("/r/other", "/r/proj", path.posix), false);
  assert.equal(agentPath("/r/proj-exec-1", "/r/proj", path.posix), true);
});

test("sweep --target selects the merge base branch", () => {
  sweepRepo();
  git("branch", "other", "wt/exec-unmerged");
  const out = sweep("--target", "other", repo);
  assert.match(out, /^remove {2}clean {2}merged {3}wt\/exec-unmerged /m);
  assert.match(out, /^target=other removed=0 kept=1 apply=0$/m);
});
