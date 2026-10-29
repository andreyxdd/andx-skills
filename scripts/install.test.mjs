import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addReactPaths, installTarget } from "../install-companions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SKILLS = `andx-init andx-plan andx-schedule andx-execute andx-orchestration andx-debug-and-fix andx-deploy
  andx-deploy-init andx-execute-and-deploy andx-execute-and-review andx-execute-review-and-deploy andx-mr-review
  andx-mr-babysit andx-mr-create andx-security-review andx-listen-start andx-listen-end`.split(/\s+/);
const tmp = (p) => fs.mkdtempSync(join(tmpdir(), p));
const real = (p) => fs.realpathSync(p);

function install(home, ...args) {
  return spawnSync(process.execPath, [join(ROOT, "install.mjs"), "--home", home, ...args], { encoding: "utf8" });
}

test("install links skills into three harnesses, agents, drops retired, writes hooks", () => {
  const home = tmp("install-home-");
  try {
    fs.mkdirSync(join(home, ".claude", "skills", "andx-pr-review"), { recursive: true });
    fs.mkdirSync(join(home, ".codex", "skills", "andx-plan"), { recursive: true });
    fs.writeFileSync(join(home, ".codex", "skills", "andx-plan", "stale.md"), "x");
    const r = install(home);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const h of [".cursor", ".claude", ".codex"]) {
      for (const s of SKILLS) assert.equal(real(join(home, h, "skills", s)), real(join(ROOT, s)), `${h}/${s}`);
      assert.equal(fs.existsSync(join(home, h, "skills", "andx-pr-review")), false);
    }
    for (const a of fs.readdirSync(join(ROOT, "agents"))) {
      assert.equal(fs.readFileSync(join(home, ".claude", "agents", a), "utf8"), fs.readFileSync(join(ROOT, "agents", a), "utf8"));
    }
    assert.match(r.stdout, /^linked .*andx-plan -> /m);
    assert.match(fs.readFileSync(join(home, ".claude", "settings.json"), "utf8"), /andx-continue\.mjs/);
    assert.match(fs.readFileSync(join(home, ".cursor", "hooks.json"), "utf8"), /deny-worktree-root\.mjs/);
    assert.equal(install(home).status, 0, "re-run over existing links");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("--uninstall-hooks removes hooks and links nothing", () => {
  const home = tmp("install-home-");
  try {
    assert.equal(install(home).status, 0);
    fs.rmSync(join(home, ".codex"), { recursive: true });
    const r = install(home, "--uninstall-hooks");
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(fs.readFileSync(join(home, ".claude", "settings.json"), "utf8"), /andx-continue/);
    assert.equal(fs.existsSync(join(home, ".codex")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-skills errors abort with nothing linked", () => {
  const root = tmp("install-root-"), home = tmp("install-home-");
  try {
    fs.mkdirSync(join(root, "scripts"));
    for (const f of ["check-skills.mjs", "install-hooks.mjs"]) fs.copyFileSync(join(here, f), join(root, "scripts", f));
    fs.copyFileSync(join(ROOT, "install.mjs"), join(root, "install.mjs"));
    fs.cpSync(join(here, "fixtures", "check-skills", "bad-yaml", "demo"), join(root, "demo"), { recursive: true });
    const r = spawnSync(process.execPath, [join(root, "install.mjs"), "--home", home], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /check-skills failed; nothing linked/);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const SKILL_MD = "---\nname: react-best-practices\ndescription: x\n---\n# Body\n\npaths: not frontmatter\n";
const WITH_PATHS = '---\nname: react-best-practices\ndescription: x\npaths: "**/*.tsx, **/*.jsx"\n---\n# Body\n\npaths: not frontmatter\n';

test("addReactPaths inserts paths into frontmatter once", () => {
  const dir = tmp("companions-");
  try {
    const f = join(dir, "SKILL.md");
    fs.writeFileSync(f, SKILL_MD);
    addReactPaths(f);
    assert.equal(fs.readFileSync(f, "utf8"), WITH_PATHS);
    addReactPaths(f);
    assert.equal(fs.readFileSync(f, "utf8"), WITH_PATHS);
    const plain = "# No frontmatter\n\n---\n\ntext\n---\n";
    fs.writeFileSync(f, plain);
    addReactPaths(f);
    assert.equal(fs.readFileSync(f, "utf8"), plain);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("installTarget copies react skill, links Matt skills, skips real dirs", (t) => {
  const dir = tmp("companions-");
  const warn = t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  try {
    const react = join(dir, "react");
    fs.mkdirSync(react);
    fs.writeFileSync(join(react, "SKILL.md"), SKILL_MD);
    const matt = join(dir, "matt");
    for (const p of ["engineering/tdd", "productivity/grilling"]) fs.mkdirSync(join(matt, "skills", p), { recursive: true });
    const target = join(dir, "target");
    fs.mkdirSync(join(target, "grilling"), { recursive: true });
    installTarget(target, react, matt, ["engineering/tdd", "productivity/grilling"]);
    assert.equal(fs.readFileSync(join(target, "react-best-practices", "SKILL.md"), "utf8"), WITH_PATHS);
    assert.equal(real(join(target, "tdd")), real(join(matt, "skills", "engineering", "tdd")));
    assert.equal(fs.lstatSync(join(target, "grilling")).isSymbolicLink(), false);
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]), [`skip ${join(target, "grilling")}: real directory (archive it first)`]);
    installTarget(target, react, matt, ["engineering/tdd"]);
    assert.equal(real(join(target, "tdd")), real(join(matt, "skills", "engineering", "tdd")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
