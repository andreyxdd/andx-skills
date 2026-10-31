import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JARGON } from "./jargon-gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gate = (args, input) => spawnSync(process.execPath, [join(here, "jargon-gate.mjs"), ...args], { encoding: "utf8", input });

// Built from fragments so this file passes the gate it tests.
const TOOL = "an" + "dx";
const W = {
  persona: "pony" + "tail",
  later: "shr" + "ink:",
  terse: "cave" + "man",
  tag: TOOL + ":",
  slash: "/" + TOOL + "-execute",
  branch: TOOL + "/exe" + "c-foo-20261101-053131",
  worktree: "repo/.work" + "trees/x",
  winWorktree: "C:\\repo\\.work" + "trees\\x",
  stamp: "exe" + "c-run-lifecycle-w1-step-5-20261101",
};

test("one constant catches every pattern from both former gates, case-insensitively", () => {
  for (const [name, s] of Object.entries(W)) assert.ok(JARGON.test(`x ${s} y`), name);
  assert.ok(JARGON.test(("Pony" + "tail") + " said so"));
  for (const s of ["Reject if remaining balance drops below rent.", "exec-run-without-date", "worktrees are fine in prose", "shrinkage"]) {
    assert.ok(!JARGON.test(s), s);
  }
});

const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const put = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

function repo() {
  const root = mkdtempSync(join(tmpdir(), "jargon-gate-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  put(root, "src/old.js", `// legacy ${W.persona} note\nconst a = 1;\n-- removed\nconst b = 2;\n`);
  put(root, "skill/SKILL.md", "# skill\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "feature");
  put(root, "src/old.js", `// legacy ${W.persona} note\nconst a = 1;\n++ ${W.tag} added\nconst b = 2;\n// ${W.later} later\n`);
  put(root, "src/new.js", `const x = 1;\nconst y = 2;\n// ${W.slash} wrote this\n`);
  put(root, "skill/NOTES.md", `see ${W.slash}\n`);
  put(root, "skill/run.mjs", `// ${W.terse}\n`);
  put(root, "docs/guide.md", `ok\n${W.branch}\n`);
  git(root, "add", ".");
  git(root, "commit", "-qm", "feature");
  return root;
}

test("diff reports only added lines as path:line of the new file", () => {
  const root = repo();
  try {
    const r = gate(["diff", "main", "feature", "--repo", root]);
    assert.equal(r.status, 1, r.stderr);
    const hits = r.stdout.split("\n").filter(Boolean).map((l) => l.split(":").slice(0, 2).join(":")).sort();
    assert.deepEqual(hits, ["docs/guide.md:2", "skill/NOTES.md:1", "skill/run.mjs:1", "src/new.js:3", "src/old.js:3", "src/old.js:5"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--allow-skill-text skips .md only inside folders that hold a SKILL.md", () => {
  const root = repo();
  try {
    const r = gate(["diff", "main", "feature", "--repo", root, "--allow-skill-text"]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /^skill\/run\.mjs:1:/m);
    assert.match(r.stdout, /^docs\/guide\.md:2:/m);
    assert.doesNotMatch(r.stdout, /NOTES\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean range exits 0", () => {
  const root = repo();
  try {
    put(root, "src/clean.js", "const z = 3;\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "clean");
    const r = gate(["diff", "HEAD~1", "HEAD", "--repo", root]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("text scans stdin and files, reporting line numbers", () => {
  const msg = `fix: guard empty balance\n\nBuilt in ${W.worktree}\n`;
  const r = gate(["text", "-"], msg);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^-:3:/m);
  assert.equal(gate(["text", "-"], "fix: guard empty balance\n").status, 0);

  const dir = mkdtempSync(join(tmpdir(), "jargon-text-"));
  try {
    writeFileSync(join(dir, "body.md"), `Summary\n${W.stamp}\n`);
    const f = gate(["text", join(dir, "body.md")]);
    assert.equal(f.status, 1);
    assert.ok(f.stdout.startsWith(`${join(dir, "body.md")}:2:`), f.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bad usage exits 2", () => {
  assert.equal(gate([]).status, 2);
  assert.equal(gate(["diff", "main"]).status, 2);
});
