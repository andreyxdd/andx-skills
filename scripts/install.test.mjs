import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addReactPaths, installTarget } from "../install-companions.mjs";
import { link } from "../install.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SKILLS = `andx-init andx-plan andx-schedule andx-execute andx-orchestration andx-debug-and-fix andx-deploy
  andx-deploy-init andx-execute-and-deploy andx-execute-and-review andx-execute-review-and-deploy andx-mr-review
  andx-mr-babysit andx-mr-create andx-security-review andx-listen-start andx-listen-end`.split(/\s+/);
const tmp = (p) => fs.mkdtempSync(join(tmpdir(), p));
const real = (p) => fs.realpathSync(p);
const LINKED_AGENTS = fs.readdirSync(join(ROOT, "agents")).filter((a) => a !== "andx-spec-reviewer.md");

function install(home, ...args) {
  return spawnSync(process.execPath, [join(ROOT, "install.mjs"), "--home", home, ...args], { encoding: "utf8" });
}

test("install links skills into ~/.agents and ~/.claude, drops its old links, agents, retired, hooks", () => {
  const home = tmp("install-home-");
  try {
    fs.mkdirSync(join(home, ".claude", "skills", "andx-pr-review"), { recursive: true });
    fs.mkdirSync(join(home, ".codex", "skills", "andx-plan"), { recursive: true });
    fs.writeFileSync(join(home, ".codex", "skills", "andx-plan", "stale.md"), "x");
    fs.mkdirSync(join(home, ".cursor", "skills"), { recursive: true });
    for (const s of ["andx-execute", "andx-pr-review"]) link(join(ROOT, s === "andx-pr-review" ? "andx-plan" : s), join(home, ".cursor", "skills", s));
    link(join(ROOT, "README.md"), join(home, ".cursor", "skills", "mine"));
    const r = install(home);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const h of [".agents", ".claude"]) {
      for (const s of SKILLS) assert.equal(real(join(home, h, "skills", s)), real(join(ROOT, s)), `${h}/${s}`);
      assert.equal(fs.existsSync(join(home, h, "skills", "andx-pr-review")), false);
    }
    assert.deepEqual(fs.readdirSync(join(home, ".cursor", "skills")), ["mine"], "old andx links gone, foreign entry kept");
    assert.ok(fs.existsSync(join(home, ".codex", "skills", "andx-plan", "stale.md")), "a real folder is not ours to delete");
    assert.match(r.stdout, /^removed old link .*andx-execute/m);
    for (const a of LINKED_AGENTS) {
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

test("spec reviewer gets a per-harness model copy; other agents stay linked and inherit", () => {
  const home = tmp("install-home-");
  const src = join(ROOT, "agents", "andx-spec-reviewer.md");
  const before = fs.readFileSync(src, "utf8");
  try {
    fs.mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    link(src, join(home, ".claude", "agents", "andx-spec-reviewer.md"));
    for (let run = 0; run < 2; run++) {
      const r = install(home);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(fs.readFileSync(src, "utf8"), before, "source untouched through an old symlink");
      for (const [h, model] of [[".claude", "sonnet"], [".cursor", "claude-sonnet-5-5"]]) {
        const f = join(home, h, "agents", "andx-spec-reviewer.md");
        assert.equal(fs.lstatSync(f).isSymbolicLink(), false, f);
        assert.equal(fs.readFileSync(f, "utf8"), before.replace("\nmodel: inherit\n", `\nmodel: ${model}\n`), f);
      }
      assert.deepEqual(fs.readdirSync(join(home, ".cursor", "agents")), ["andx-spec-reviewer.md"]);
      assert.ok(LINKED_AGENTS.length >= 4, "other agents found");
      for (const a of LINKED_AGENTS) {
        const f = join(home, ".claude", "agents", a);
        if (process.platform !== "win32") assert.equal(fs.lstatSync(f).isSymbolicLink(), true, f);
        assert.match(fs.readFileSync(f, "utf8"), /^model: inherit$/m, f);
      }
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Codex gets TOML agents and Kimi linked agents only when installed", () => {
  const home = tmp("install-home-");
  try {
    assert.equal(install(home).status, 0);
    assert.equal(fs.existsSync(join(home, ".codex")) || fs.existsSync(join(home, ".kimi-code")), false);
    fs.mkdirSync(join(home, ".codex"));
    fs.mkdirSync(join(home, ".kimi-code"));
    assert.equal(install(home).status, 0);
    const all = fs.readdirSync(join(ROOT, "agents")).filter((a) => a.endsWith(".md")).sort();
    assert.deepEqual(fs.readdirSync(join(home, ".codex", "agents")).sort(), all.map((a) => a.replace(/\.md$/, ".toml")));
    assert.deepEqual(fs.readdirSync(join(home, ".kimi-code", "agents")).sort(), all);
    const toml = fs.readFileSync(join(home, ".codex", "agents", "andx-analyst.toml"), "utf8");
    const src = fs.readFileSync(join(ROOT, "agents", "andx-analyst.md"), "utf8");
    assert.match(toml, /^name = "andx-analyst"$/m);
    assert.match(toml, /^description = "Read-only root-cause analyst for andx-debug-and-fix: .*"$/m);
    const instr = JSON.parse(toml.match(/^developer_instructions = (".*")$/m)[1]);
    assert.equal(instr, src.split(/^---$/m).slice(2).join("---").trim());
    assert.equal(toml.split("\n").filter((l) => l && !l.startsWith("#")).length, 3, "one line per key: JSON string escapes are TOML basic strings");
    assert.match(fs.readFileSync(join(home, ".codex", "hooks.json"), "utf8"), /apply_patch\|Edit\|Write/);
    assert.match(fs.readFileSync(join(home, ".kimi-code", "config.toml"), "utf8"), /andx-continue\.mjs\\" --exit2"/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("--uninstall-hooks removes hooks and links nothing", () => {
  const home = tmp("install-home-");
  try {
    assert.equal(install(home).status, 0);
    const r = install(home, "--uninstall-hooks");
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(fs.readFileSync(join(home, ".claude", "settings.json"), "utf8"), /andx-continue/);
    assert.equal(fs.existsSync(join(home, ".codex")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("--worktree-backend sets the global git config under --home; a bad value links nothing", () => {
  const home = tmp("install-home-");
  try {
    assert.equal(install(home, "--worktree-backend", "fast").status, 2);
    assert.deepEqual(fs.readdirSync(home), []);
    const r = install(home, "--worktree-backend", "wt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^worktree backend: git config --global andx\.worktreeBackend = wt$/m);
    assert.match(fs.readFileSync(join(home, ".gitconfig"), "utf8"), /\[andx\]\s+worktreeBackend = wt/);
    const help = spawnSync(process.execPath, [join(ROOT, "install.mjs"), "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--worktree-backend native\|auto\|wt/);
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
