import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let dir, repo;

const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
function guard(input, script = join(here, "guard-primary.mjs")) {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", input: typeof input === "string" ? input : JSON.stringify(input) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ledger = (extra = {}, slug = "feat") => {
  const p = join(repo, ".worktrees", ".andx-run", `${slug}.json`);
  writeFileSync(p, JSON.stringify({ slug, mode: "execute", phase: "A", terminal: null, ...extra }));
  return p;
};
const claude = (file, tool = "Edit") => ({ hook_event_name: "PreToolUse", cwd: repo, tool_name: tool, tool_input: { file_path: file } });
const cursor = (file, tool = "Write") => ({ hook_event_name: "preToolUse", cwd: repo, tool_name: tool, tool_input: { path: file } });
const ALLOW = { code: 0, out: "", err: "" };

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "guard-")));
  repo = join(dir, "repo");
  mkdirSync(join(repo, ".worktrees", ".andx-run"), { recursive: true });
  sh("git", ["init", "-q", "-b", "main"], repo);
  sh("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], repo);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("no ledger: primary checkout edit allowed", () => {
  assert.deepEqual(guard(claude(join(repo, "src", "a.js"))), ALLOW);
});

test("active run: Claude edit in the primary checkout denied with reason on stderr", () => {
  ledger();
  const r = guard(claude(join(repo, "src", "a.js")));
  assert.equal(r.code, 2);
  assert.match(r.err, /Run 'feat' is active/);
  assert.match(r.err, /--terminal ABORTED/);
});

test("active run: Cursor write and delete denied with permission deny", () => {
  ledger();
  for (const tool of ["Write", "StrReplace", "Delete"]) {
    const r = guard(cursor(join(repo, "README.md"), tool));
    assert.equal(r.code, 2, tool);
    assert.equal(JSON.parse(r.out).permission, "deny");
  }
});

test("active run: notebook and relative paths denied", () => {
  ledger();
  assert.equal(guard({ cwd: repo, tool_name: "NotebookEdit", tool_input: { notebook_path: join(repo, "n.ipynb") } }).code, 2);
  assert.equal(guard(claude("src/a.js", "Write")).code, 2);
});

test("active run: a symlink in an open folder is judged by its target", { skip: process.platform === "win32" }, () => {
  ledger();
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, ".cursor", "plans"), { recursive: true });
  writeFileSync(join(repo, "src", "a.js"), "");
  symlinkSync(join("..", "..", "src", "a.js"), join(repo, ".cursor", "plans", "link.md"));
  symlinkSync(join("..", "..", "src", "gone.js"), join(repo, ".cursor", "plans", "dangling.md"));
  assert.equal(guard(claude(join(repo, ".cursor", "plans", "link.md"))).code, 2);
  assert.equal(guard(claude(join(repo, ".cursor", "plans", "dangling.md"), "Write")).code, 2);
  writeFileSync(join(repo, ".cursor", "plans", "real.md"), "");
  assert.deepEqual(guard(claude(join(repo, ".cursor", "plans", "real.md"))), ALLOW);
});

test("active run: links and dot-dot steps out of an open folder are followed like the OS does", { skip: process.platform === "win32" }, () => {
  ledger();
  mkdirSync(join(repo, "src"));
  symlinkSync(join("..", "src"), join(repo, ".worktrees", "L"));
  symlinkSync(join("..", "x", "new"), join(repo, "src", "dangle"));
  assert.equal(guard(claude(join(repo, ".worktrees", "L", "dangle"), "Write")).code, 2);
  assert.equal(guard(claude(`${repo}/.worktrees/L/../a.js`)).code, 2);
  assert.deepEqual(guard(claude(`${repo}/.worktrees/exec-x/../exec-y/a.js`)), ALLOW);
});

test("active run: Codex apply_patch denied when any patched file is in the primary checkout", () => {
  ledger();
  const patch = (...files) => ({ cwd: repo, tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n${files.join("\n+x\n")}\n*** End Patch\n` } });
  assert.deepEqual(guard(patch("*** Add File: .worktrees/exec-x/a.js")), ALLOW);
  assert.equal(guard(patch("*** Add File: .worktrees/exec-x/a.js", "*** Update File: src/a.js")).code, 2);
  assert.equal(guard(patch(`*** Update File: ${join(repo, ".andx", "plans", "p.md")}`, "*** Move to: src/b.js")).code, 2);
  assert.equal(guard(patch("*** Delete File: README.md")).code, 2);
  assert.deepEqual(guard({ cwd: repo, tool_name: "apply_patch", tool_input: { command: "not a patch" } }), ALLOW);
});

test("active run: Cursor payload with tool_input as a JSON string denied", () => {
  ledger();
  const r = guard({ cwd: repo, tool_name: "Write", tool_input: JSON.stringify({ path: join(repo, "a.js") }) });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.out).permission, "deny");
});

test("active run: dot-dot names inside the repo and the git dir are denied", () => {
  ledger();
  assert.equal(guard(claude(join(repo, "..env"))).code, 2);
  assert.equal(guard(claude(join(repo, ".git", "config"))).code, 2);
  assert.equal(guard(claude(join(repo, ".git", "hooks", "pre-commit"), "Write")).code, 2);
});

test("active run: worktrees, plans, reviews and the ledger dir allowed", () => {
  ledger();
  for (const rel of [[".worktrees", "exec-x", "a.js"], [".cursor", "plans", "p.plan.md"], [".cursor", "reviews", "r.json"], [".worktrees", ".andx-run", "feat.json"]]) {
    assert.deepEqual(guard(claude(join(repo, ...rel))), ALLOW, rel.join("/"));
  }
  assert.equal(guard(claude(join(repo, ".cursor", "rules", "x.mdc"))).code, 2);
  assert.deepEqual(guard(claude(join(repo, ".andx", "plans", "p.plan.md"))), ALLOW);
  assert.equal(guard(claude(join(repo, "docs", "plans", "p.plan.md"))).code, 2, "docs/plans is not a plans dir until it exists");
  mkdirSync(join(repo, "docs", "plans"), { recursive: true });
  assert.deepEqual(guard(claude(join(repo, "docs", "plans", "p.plan.md"))), ALLOW);
});

test("active run: edit inside a linked worktree outside the repo allowed", () => {
  ledger();
  const wt = join(dir, "elsewhere");
  sh("git", ["worktree", "add", "-q", "-b", "side", wt, "main"], repo);
  assert.deepEqual(guard(claude(join(wt, "a.js"))), ALLOW);
});

test("terminal, stale or other-repo ledgers allow", () => {
  const p = ledger({ terminal: "DONE" });
  assert.deepEqual(guard(claude(join(repo, "a.js"))), ALLOW);
  ledger();
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  utimesSync(p, old, old);
  assert.deepEqual(guard(claude(join(repo, "a.js"))), ALLOW);
  ledger({}, "fresh");
  const other = join(dir, "other");
  mkdirSync(other);
  sh("git", ["init", "-q"], other);
  assert.deepEqual(guard(claude(join(other, "a.js"))), ALLOW);
});

test("non-edit tools, paths outside any repo and malformed stdin allow", () => {
  ledger();
  assert.deepEqual(guard({ cwd: repo, tool_name: "Read", tool_input: { path: join(repo, "a.js") } }), ALLOW);
  assert.deepEqual(guard({ cwd: repo, tool_name: "Shell", tool_input: { command: "rm a.js" } }), ALLOW);
  assert.deepEqual(guard(claude(join(dir, "loose.txt"))), ALLOW);
  assert.deepEqual(guard("not json {{"), ALLOW);
});

test("ledger module that fails to load fails open", () => {
  ledger();
  const lone = join(dir, "lone", "hooks");
  mkdirSync(lone, { recursive: true });
  copyFileSync(join(here, "guard-primary.mjs"), join(lone, "guard-primary.mjs"));
  assert.deepEqual(guard(claude(join(repo, "a.js")), join(lone, "guard-primary.mjs")), ALLOW);
});
