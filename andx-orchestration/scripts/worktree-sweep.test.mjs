import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path, { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { agentPath } from "./worktree-sweep.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "worktree-sweep.mjs");
let repo;

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}
const git = (...a) => run("git", a);
const commit = (cwd, m) => run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", m], cwd);
const sweep = (...a) => run(process.execPath, [SCRIPT, ...a]);

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "sweep-")));
  git("init", "-q", "-b", "main");
  commit(repo, "init");
  for (const n of ["merged", "dirty", "unmerged"]) git("worktree", "add", "-q", "-b", `wt/exec-${n}`, `.worktrees/exec-${n}`, "main");
  commit(join(repo, ".worktrees", "exec-unmerged"), "wip");
  fs.writeFileSync(join(repo, ".worktrees", "exec-dirty", "x.txt"), "x");
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test("apply removes only clean merged worktrees", () => {
  const out = sweep("--apply", repo);
  const list = git("worktree", "list");
  assert.doesNotMatch(list, /exec-merged/, out);
  assert.match(list, /exec-dirty/);
  assert.match(list, /exec-unmerged/);
  assert.match(out, /^target=main removed=1 kept=2 apply=1$/m);
  assert.doesNotMatch(git("branch"), /wt\/exec-merged/);
});

test("dry run removes nothing and prints actions", () => {
  const out = sweep(repo);
  assert.match(git("worktree", "list"), /exec-merged/);
  assert.match(out, /^remove {2}clean {2}merged {3}wt\/exec-merged \S.*exec-merged$/m);
  assert.match(out, /^keep {4}dirty  merged {3}wt\/exec-dirty \S.*exec-dirty$/m);
  assert.match(out, /^keep {4}clean  unmerged wt\/exec-unmerged \S.*exec-unmerged$/m);
  assert.match(out, /^ {8}manual: git worktree remove --force '.*exec-dirty' && git branch -D 'wt\/exec-dirty' {2}# only after you confirm$/m);
  assert.match(out, /^target=main removed=0 kept=2 apply=0$/m);
});

test("agent worktree paths match across separators and drive-letter case", () => {
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

test("--target selects the merge base branch", () => {
  git("branch", "other", "wt/exec-unmerged");
  const out = sweep("--target", "other", repo);
  assert.match(out, /^remove {2}clean {2}merged {3}wt\/exec-unmerged /m);
  assert.match(out, /^target=other removed=0 kept=1 apply=0$/m);
});
