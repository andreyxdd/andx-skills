import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path, { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentPath, findWt, wtCandidates } from "./worktree.mjs";
import { runNames } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "worktree.mjs");
const RUN = join(here, "run.mjs");
// The developer's global andx.worktreeBackend must not pick the backend under test.
process.env.GIT_CONFIG_GLOBAL = join(fs.mkdtempSync(join(tmpdir(), "worktree-home-")), "gitconfig");
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, "");
process.env.GIT_CONFIG_NOSYSTEM = "1";
let repo;

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}
const git = (...a) => run("git", a);
const commit = (cwd, m) => run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", m], cwd);
// An empty commit counts as integrated, so unmerged work needs content.
const change = (cwd, m, file = `${m}.txt`, body = m) => {
  fs.writeFileSync(join(cwd, file), body);
  run("git", ["add", file], cwd);
  commit(cwd, m);
};
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
  // shasum -a 256 of that branch name starts fab7201d; 10000 + 0xfab7201d % 10000
  assert.equal(v.PORT, "15309");
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
    EXEC_BRANCH: start.EXEC_BRANCH, WORKTREE_DIR: start.WORKTREE_DIR, TARGET_BRANCH: "main", port: Number(v.PORT),
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
  const r = wt("create", "--slug", "feat", "--stamp", "20261101-062708");
  assert.equal(r.status, 4, r.stdout + r.stderr);
  const { WORKTREE_DIR } = runNames({ root: repo, slug: "feat", stamp: "20261101-062708" });
  assert.equal(fs.readFileSync(join(WORKTREE_DIR, "root.txt"), "utf8"), repo);
  assert.match(r.stdout, /^SETUP exit=0 /m);
  assert.match(r.stdout, /^SETUP exit=3 /m);
  assert.doesNotMatch(r.stdout, /^(EXEC_BRANCH|WORKTREE_DIR|TARGET_BRANCH|PORT)=/m, "a half-built worktree is never announced");
});

test("create prints BACKEND first and the worktree lines only after seed, setup and baseline", () => {
  fs.writeFileSync(join(repo, ".gitignore"), ".env.local\n");
  fs.writeFileSync(join(repo, ".env.local"), "x");
  fs.writeFileSync(join(repo, ".worktreeinclude"), ".env.local\n");
  fs.mkdirSync(join(repo, ".cursor"));
  fs.writeFileSync(join(repo, ".cursor", "worktrees.json"), JSON.stringify({ "setup-worktree": [`${JSON.stringify(process.execPath)} -e ""`] }));
  const r = wt("create", "--slug", "feat", "--baseline", "exit 0");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const tags = r.stdout.split("\n").map((l) => /^(BACKEND|SEED|SETUP exit|BASELINE|EXEC_BRANCH|WORKTREE_DIR|TARGET_BRANCH|PORT)\b/.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(tags, ["BACKEND", "SEED", "SETUP exit", "BASELINE", "EXEC_BRANCH", "WORKTREE_DIR", "TARGET_BRANCH", "PORT"]);
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
  git("config", `worktrunk.state.${v.EXEC_BRANCH}.marker`, '{"marker":"🤖","set_at":1}');
  const r = wt("remove", "feat");
  assert.notEqual(spawnSync("git", ["config", "--get", `worktrunk.state.${v.EXEC_BRANCH}.marker`], { cwd: repo }).status, 0, "marker cleared");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // git worktree list prints C:/... on Windows while WORKTREE_DIR uses backslashes.
  const slash = (s) => s.replaceAll("\\", "/");
  const [before, after] = slash(r.stdout).split("# git worktree list (after)");
  assert.ok(before.includes(slash(v.WORKTREE_DIR)), before);
  assert.ok(!after.includes(slash(v.WORKTREE_DIR)), after);
  assert.doesNotMatch(git("branch"), /exec-feat/);
});

test("remove keeps a dirty worktree and an unmerged branch", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  fs.writeFileSync(join(v.WORKTREE_DIR, "x.txt"), "x");
  let r = wt("remove", "feat");
  assert.equal(r.status, 1);
  assert.ok(fs.existsSync(v.WORKTREE_DIR));
  fs.rmSync(join(v.WORKTREE_DIR, "x.txt"));
  change(v.WORKTREE_DIR, "wip");
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
  change(join(repo, ".worktrees", "exec-unmerged"), "wip");
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

const porcelain = () => git("worktree", "list", "--porcelain");

test("create locks the worktree so git itself refuses to remove it; remove unlocks and removes", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  assert.ok(porcelain().includes(`locked andx feat ${v.EXEC_BRANCH}`), porcelain());
  assert.notEqual(spawnSync("git", ["worktree", "remove", v.WORKTREE_DIR], { cwd: repo }).status, 0);
  assert.equal(wt("remove", "feat").status, 0);
  assert.ok(!fs.existsSync(v.WORKTREE_DIR));
});

test("remove leaves a lock it does not own: git refuses, worktree kept", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  git("worktree", "unlock", v.WORKTREE_DIR);
  git("worktree", "lock", "--reason", "andx feature other", v.WORKTREE_DIR);
  const r = wt("remove", "feat");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^KEEP .*exec-feat-/m);
  assert.ok(porcelain().includes("locked andx feature other"));
});

test("sweep keeps a live run's locked worktree and unlocks it once the run is terminal or stale", () => {
  run(process.execPath, [RUN, "start", "--slug", "feat", "--mode", "execute"]);
  const v = vars(wt("create", "--slug", "feat").stdout);
  let out = sweep("--apply", repo);
  assert.match(out, new RegExp(`^keep {4}locked andx feat ${v.EXEC_BRANCH} ${v.EXEC_BRANCH} \\S`, "m"));
  assert.match(out, /^target=main removed=0 kept=1 apply=1$/m);
  assert.ok(fs.existsSync(v.WORKTREE_DIR));

  const old = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(join(repo, ".worktrees", ".andx-run", "feat.json"), old, old);
  out = sweep(repo);
  assert.match(out, /^unlock {2}dead-run andx feat /m);
  assert.match(out, /^remove {2}clean {2}merged /m);
  assert.ok(porcelain().includes("locked andx feat"), "dry run keeps the lock");

  run(process.execPath, [RUN, "end", "feat", "--terminal", "ABORTED"]);
  out = sweep("--apply", repo);
  assert.match(out, /^target=main removed=1 kept=0 apply=1$/m);
  assert.ok(!fs.existsSync(v.WORKTREE_DIR));
});

test("a squash-merged branch counts as integrated: sweep removes it, remove deletes the branch", () => {
  const v = vars(wt("create", "--slug", "feat").stdout);
  change(v.WORKTREE_DIR, "feature", "a.txt", "same change\n");
  change(repo, "squash of feature", "a.txt", "same change\n");
  git("worktree", "add", "-q", "-b", "wt/exec-squash", join(".worktrees", "exec-squash"), v.EXEC_BRANCH);
  assert.match(sweep(repo), /^remove {2}clean {2}integrated wt\/exec-squash /m);
  const r = wt("remove", "feat");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, new RegExp(`^DELETED branch ${v.EXEC_BRANCH}$`, "m"));
});

function seedRepo() {
  fs.writeFileSync(join(repo, ".gitignore"), "node_modules/\n.env\ncfg.local\n");
  run("git", ["add", ".gitignore"]);
  fs.writeFileSync(join(repo, "cfg.local"), "branch");
  run("git", ["add", "-f", "cfg.local"]);
  commit(repo, "base");
  // The primary checkout moves to a branch where cfg.local is untracked, so it is a seed candidate
  // that already exists in a worktree of main.
  git("switch", "-q", "-c", "side");
  git("rm", "-q", "--cached", "cfg.local");
  commit(repo, "untrack cfg.local");
  fs.writeFileSync(join(repo, "cfg.local"), "primary");
  fs.mkdirSync(join(repo, "node_modules", "a", ".bin"), { recursive: true });
  fs.writeFileSync(join(repo, "node_modules", "a", "i.js"), "x");
  fs.symlinkSync(join("..", "i.js"), join(repo, "node_modules", "a", ".bin", "i"), "file");
  fs.writeFileSync(join(repo, ".env"), "SECRET=1");
  fs.writeFileSync(join(repo, "inc.txt"), "listed but not ignored");
  fs.writeFileSync(join(repo, ".worktreeinclude"), "node_modules/\ncfg.local\ninc.txt\n");
}

test("create seeds .worktreeinclude entries that are also git-ignored, copy-on-write, links verbatim", () => {
  seedRepo();
  run(process.execPath, [RUN, "start", "--slug", "feat", "--mode", "execute"]);
  const r = wt("create", "--slug", "feat", "--target", "main");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // node_modules is copied; cfg.local already exists in the worktree, so it is not counted.
  assert.match(r.stdout, /^SEED 1 entries$/m);
  const d = vars(r.stdout).WORKTREE_DIR;
  assert.equal(fs.readFileSync(join(d, "node_modules", "a", "i.js"), "utf8"), "x");
  assert.equal(fs.readlinkSync(join(d, "node_modules", "a", ".bin", "i")), join("..", "i.js"));
  assert.equal(fs.readFileSync(join(d, "cfg.local"), "utf8"), "branch", "existing file kept");
  assert.ok(!fs.existsSync(join(d, ".env")), "ignored but not listed");
  assert.ok(!fs.existsSync(join(d, "inc.txt")), "listed but not ignored");
  assert.deepEqual(ledgerOf("feat").worktrees[path.basename(d)].seed, { entries: 1 });
});

test("create without .worktreeinclude copies nothing", () => {
  seedRepo();
  fs.rmSync(join(repo, ".worktreeinclude"));
  const r = wt("create", "--slug", "feat", "--target", "main");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /SEED/);
  assert.ok(!fs.existsSync(join(vars(r.stdout).WORKTREE_DIR, "node_modules")));
});

const FAKE = join(here, "fixtures", "fake-wt", "wt.mjs");
// A bin dir whose wt and git-wt run the fake; returns the env to run worktree.mjs with and the logged calls.
function fakeWt(extra = {}) {
  const bin = join(repo, ".git", "fake-wt");
  fs.mkdirSync(bin);
  for (const n of ["wt", "git-wt"]) {
    if (process.platform === "win32") fs.writeFileSync(join(bin, `${n}.cmd`), `@"${process.execPath}" "${FAKE}" %*\r\n`);
    else fs.writeFileSync(join(bin, n), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  }
  const log = join(bin, "calls.jsonl");
  const PATH = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env = { ...process.env, [PATH]: `${bin}${path.delimiter}${process.env[PATH]}`, FAKE_WT_LOG: log, ...extra };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { run: (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: repo, encoding: "utf8", env }), calls };
}

test("wt backend: create runs wt switch from the primary checkout, then locks; remove runs wt remove", () => {
  git("config", "andx.worktreeBackend", "wt");
  const f = fakeWt();
  const r = f.run("create", "--slug", "feat", "--stamp", "20261101-062708");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = vars(r.stdout);
  assert.equal(v.BACKEND, "wt");
  assert.deepEqual({ EXEC_BRANCH: v.EXEC_BRANCH, WORKTREE_DIR: v.WORKTREE_DIR }, runNames({ root: repo, slug: "feat", stamp: "20261101-062708" }));
  assert.equal(v.TARGET_BRANCH, "main");
  assert.equal(v.PORT, "15309", "same port as the native backend for this branch");
  assert.ok(!f.calls().some((c) => c[2] === "step" && c[3] === "eval"), "no wt call for the port");
  assert.ok(porcelain().includes(`locked andx feat ${v.EXEC_BRANCH}`), porcelain());
  assert.ok(f.calls().some((c) => c.join(" ") === `-C ${repo} switch --create ${v.EXEC_BRANCH} --base main --path ${v.WORKTREE_DIR} --no-cd --format json`), JSON.stringify(f.calls()));
  assert.ok(!f.calls().some((c) => c[2] === "step" && c[3] === "copy-ignored"), "no .worktreeinclude, no copy");

  const rm = f.run("remove", "feat");
  assert.equal(rm.status, 0, rm.stdout + rm.stderr);
  assert.match(rm.stdout, /^BACKEND=wt$/m);
  assert.match(rm.stdout, new RegExp(`^DELETED branch ${v.EXEC_BRANCH}$`, "m"));
  assert.ok(f.calls().some((c) => c.join(" ") === `-C ${repo} remove ${v.EXEC_BRANCH} --foreground --format json`));
  assert.ok(!fs.existsSync(v.WORKTREE_DIR));
  assert.ok(!f.calls().flat().some((a) => a === "--yes" || a === "-y"), "never auto-approves");
});

test("wt backend seeds with wt step copy-ignored only when .worktreeinclude exists", () => {
  git("config", "andx.worktreeBackend", "wt");
  fs.writeFileSync(join(repo, ".worktreeinclude"), "node_modules/\n");
  const f = fakeWt();
  const r = f.run("create", "--slug", "feat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^SEED 1 entries$/m);
  const dir = vars(r.stdout).WORKTREE_DIR;
  assert.ok(f.calls().some((c) => c.join(" ") === `-C ${dir} step copy-ignored --require-include --format json`));
});

test("wt mode without worktrunk exits 3; auto falls back to native; Windows Terminal's wt is not worktrunk", () => {
  const f = fakeWt({ FAKE_WT_VERSION: "Windows Terminal 1.21.2361.0" });
  git("config", "andx.worktreeBackend", "wt");
  const r = f.run("create", "--slug", "feat");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /worktrunk/);
  assert.ok(!fs.existsSync(join(repo, ".worktrees")) || fs.readdirSync(join(repo, ".worktrees")).length === 0);
  git("config", "andx.worktreeBackend", "auto");
  const a = f.run("create", "--slug", "feat");
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^BACKEND=native \(wt not found\)$/m);
  git("config", "andx.worktreeBackend", "fast");
  assert.equal(f.run("create", "--slug", "feat").status, 2);
});

test("wt backend stops on unapproved project hooks and names the approval command", () => {
  git("config", "andx.worktreeBackend", "wt");
  const r = fakeWt({ FAKE_WT_UNAPPROVED: "1" }).run("create", "--slug", "feat");
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /wt -C .* config approvals add/);
  assert.doesNotMatch(r.stdout, /EXEC_BRANCH=/);
});

test("wt candidates: Windows tries git-wt, then wt only outside WindowsApps", () => {
  const where = (n) => ({
    "git-wt": [],
    wt: ["C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe", "C:\\tools\\worktrunk\\wt.exe"],
  })[n];
  assert.deepEqual(wtCandidates("win32", where), ["C:\\tools\\worktrunk\\wt.exe"]);
  assert.deepEqual(wtCandidates("win32", (n) => (n === "git-wt" ? ["C:\\x\\git-wt.exe"] : [])), ["C:\\x\\git-wt.exe"]);
  assert.deepEqual(wtCandidates("darwin"), ["wt", "git-wt"]);
});

test("real worktrunk round trip", { skip: !findWt() && "worktrunk not installed" }, () => {
  git("config", "andx.worktreeBackend", "wt");
  const r = wt("create", "--slug", "feat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = vars(r.stdout);
  assert.equal(v.BACKEND, "wt");
  assert.match(v.PORT, /^1\d{4}$/);
  assert.ok(porcelain().includes(`locked andx feat ${v.EXEC_BRANCH}`));
  const rm = wt("remove", "feat");
  assert.equal(rm.status, 0, rm.stdout + rm.stderr);
  assert.match(rm.stdout, new RegExp(`^DELETED branch ${v.EXEC_BRANCH}$`, "m"));
  assert.ok(!fs.existsSync(v.WORKTREE_DIR));
});

test("create --branch checks out an existing branch, locked; remove keeps the branch", () => {
  git("branch", "mr-head");
  const r = wt("create", "--slug", "mr-7", "--branch", "mr-head");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = vars(r.stdout);
  assert.equal(v.EXEC_BRANCH, "mr-head");
  assert.equal(v.WORKTREE_DIR, join(repo, ".worktrees", "mr-7"));
  assert.equal(run("git", ["branch", "--show-current"], v.WORKTREE_DIR).trim(), "mr-head");
  assert.ok(porcelain().includes("locked andx mr-7 mr-head"));
  const rm = wt("remove", "mr-7");
  assert.equal(rm.status, 0, rm.stdout + rm.stderr);
  assert.ok(!fs.existsSync(v.WORKTREE_DIR));
  assert.match(git("branch"), /mr-head/);
});

test("create --branch --track resets the branch to the remote one", () => {
  const origin = join(repo, ".git", "origin.git");
  git("init", "-q", "--bare", origin);
  git("remote", "add", "origin", origin);
  git("switch", "-q", "-c", "feat-x");
  change(repo, "remote work");
  git("push", "-q", "origin", "feat-x");
  git("switch", "-q", "main");
  git("branch", "-f", "feat-x", "main");
  const r = wt("create", "--slug", "mr-8", "--branch", "feat-x", "--track", "origin/feat-x");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = vars(r.stdout).WORKTREE_DIR;
  assert.equal(d, join(repo, ".worktrees", "mr-8"));
  assert.equal(git("rev-parse", "feat-x").trim(), git("rev-parse", "origin/feat-x").trim());
  assert.equal(git("rev-parse", "--abbrev-ref", "feat-x@{upstream}").trim(), "origin/feat-x");
});

test("create --branch refuses the primary checkout's branch: stop and ask", () => {
  const r = wt("create", "--slug", "mr-9", "--branch", "main");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /stop and ask the user/);
  assert.equal(wt("create", "--slug", "mr-9", "--track", "origin/x").status, 2, "--track needs --branch");
});

test("wt backend: create --branch runs wt switch on the branch, seeds natively; remove keeps it", () => {
  git("config", "andx.worktreeBackend", "wt");
  git("branch", "mr-head");
  fs.writeFileSync(join(repo, ".worktreeinclude"), "node_modules/\n");
  const f = fakeWt();
  const r = f.run("create", "--slug", "mr-7", "--branch", "mr-head");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = vars(r.stdout).WORKTREE_DIR;
  assert.ok(f.calls().some((c) => c.join(" ") === `-C ${repo} switch mr-head --path ${d} --no-cd --format json`), JSON.stringify(f.calls()));
  assert.match(r.stdout, /^SEED 0 entries$/m);
  assert.ok(!f.calls().some((c) => c.includes("copy-ignored")), "the branch's own rules are not handed to wt");
  assert.ok(porcelain().includes("locked andx mr-7 mr-head"));
  assert.equal(f.run("remove", "mr-7").status, 0);
  assert.ok(f.calls().some((c) => c.join(" ") === `-C ${repo} remove mr-head --no-delete-branch --foreground --format json`));
  assert.match(git("branch"), /mr-head/);
});

test("create --branch seeds only what the branch's own .gitignore also ignores", () => {
  fs.writeFileSync(join(repo, ".gitignore"), ".env.local\n");
  run("git", ["add", ".gitignore"]);
  commit(repo, "primary ignores .env.local");
  git("switch", "-q", "-c", "mr-head");
  fs.writeFileSync(join(repo, ".gitignore"), "");
  run("git", ["add", ".gitignore"]);
  commit(repo, "branch ignores nothing");
  git("switch", "-q", "main");
  fs.writeFileSync(join(repo, ".env.local"), "SECRET=1");
  fs.writeFileSync(join(repo, ".worktreeinclude"), ".env.local\n");
  const r = wt("create", "--slug", "mr-7", "--branch", "mr-head");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^SEED 0 entries$/m);
  assert.ok(!fs.existsSync(join(vars(r.stdout).WORKTREE_DIR, ".env.local")));
});

test("seeding never writes through a symlinked dir in the checkout", { skip: process.platform === "win32" && "git checks out symlinks as files there" }, () => {
  const outside = fs.mkdtempSync(join(tmpdir(), "worktree-outside-"));
  fs.writeFileSync(join(repo, ".gitignore"), "cache/\n");
  run("git", ["add", ".gitignore"]);
  fs.symlinkSync(outside, join(repo, "cache"));
  run("git", ["add", "-f", "cache"]);
  commit(repo, "cache links outside");
  git("switch", "-q", "-c", "side");
  git("rm", "-q", "--cached", "cache");
  commit(repo, "untrack cache");
  fs.unlinkSync(join(repo, "cache"));
  fs.mkdirSync(join(repo, "cache"));
  fs.writeFileSync(join(repo, "cache", "data.txt"), "x");
  fs.writeFileSync(join(repo, ".worktreeinclude"), "cache/\n");
  const r = wt("create", "--slug", "feat", "--target", "main");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^SEED skip cache: destination resolves outside the worktree$/m);
  assert.match(r.stdout, /^SEED 0 entries$/m);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmSync(outside, { recursive: true, force: true });
});

test("wt backend: a failed lock rolls back with a single --force, so a foreign lock still wins", () => {
  git("config", "andx.worktreeBackend", "wt");
  const r = fakeWt({ FAKE_WT_LOCK: "1" }).run("create", "--slug", "feat");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /git worktree lock failed; left .* in place/);
  assert.match(git("worktree", "list"), /exec-feat/);
});

test("wt backend: create on an existing worktree folder refuses before calling wt", () => {
  git("config", "andx.worktreeBackend", "wt");
  git("branch", "mr-head");
  const f = fakeWt();
  const d = vars(f.run("create", "--slug", "mr-7", "--branch", "mr-head").stdout).WORKTREE_DIR;
  fs.writeFileSync(join(d, "edit.txt"), "unsaved work");
  const switches = () => f.calls().filter((c) => c[2] === "switch").length;
  const before = switches();
  const r = f.run("create", "--slug", "mr-7", "--branch", "mr-head");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /already exists/);
  assert.equal(switches(), before, "no wt call");
  assert.equal(fs.readFileSync(join(d, "edit.txt"), "utf8"), "unsaved work");
  assert.ok(porcelain().includes("locked andx mr-7 mr-head"));
});

test("seeding never follows a symlink below a dir the checkout already has", { skip: process.platform === "win32" && "git checks out symlinks as files there" }, () => {
  const outside = fs.mkdtempSync(join(tmpdir(), "worktree-outside-"));
  fs.writeFileSync(join(repo, ".gitignore"), "cache/\n");
  run("git", ["add", ".gitignore"]);
  commit(repo, "ignore cache");
  git("switch", "-q", "-c", "linked");
  fs.mkdirSync(join(repo, "cache"));
  fs.writeFileSync(join(repo, "cache", "keep.txt"), "k");
  fs.symlinkSync(outside, join(repo, "cache", "sub"));
  run("git", ["add", "-f", "cache"]);
  commit(repo, "cache/sub links outside");
  git("switch", "-q", "main");
  fs.mkdirSync(join(repo, "cache", "sub"), { recursive: true });
  fs.writeFileSync(join(repo, "cache", "sub", "data.txt"), "x");
  fs.writeFileSync(join(repo, ".worktreeinclude"), "cache/\n");
  const r = wt("create", "--slug", "feat", "--target", "linked");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^SEED skip ${join("cache", "sub")}: destination resolves outside the worktree$`, "m"));
  assert.match(r.stdout, /^SEED 0 entries$/m, "cache already exists and its only new path was skipped");
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.rmSync(outside, { recursive: true, force: true });
});

test("create refuses a symlinked .worktrees", () => {
  const elsewhere = fs.mkdtempSync(join(tmpdir(), "worktree-elsewhere-"));
  fs.symlinkSync(elsewhere, join(repo, ".worktrees"), process.platform === "win32" ? "junction" : "dir");
  const r = wt("create", "--slug", "feat");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /symlink/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.rmSync(elsewhere, { recursive: true, force: true });
});
