import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const F = join(here, "fixtures", "check-skills");

function withHome(fn) {
  const d = mkdtempSync(join(tmpdir(), "check-skills-"));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

const run = (args, home) => withHome((tmp) => {
  const h = home ?? tmp;
  return spawnSync(process.execPath, [join(here, "check-skills.mjs"), ...args],
    { encoding: "utf8", env: { ...process.env, HOME: h, USERPROFILE: h } });
});

const write = (d, rel, text) => {
  mkdirSync(join(d, dirname(rel)), { recursive: true });
  writeFileSync(join(d, rel), text);
};

test("valid fixture passes", () => {
  const r = run([join(F, "valid")]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^check-skills: 0 errors, 0 warnings$/m);
});

test("bad yaml fails", () => {
  const r = run([join(F, "bad-yaml")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error: demo: invalid frontmatter/);
});

test("wrong name fails", () => {
  assert.match(run([join(F, "wrong-name")]).stdout, /error: demo: name 'other' != folder/);
});

test("broken local link fails", () => {
  const r = run([join(F, "broken-link")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error: demo\/SKILL\.md: unresolved link \.\/MISSING\.md/);
});

test("unknown frontmatter keys fail", () => {
  const r = run([join(F, "unknown-key")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error: demo: unknown frontmatter key 'bogus'/);
  assert.match(r.stdout, /error: agents\/demo-agent\.md: unknown frontmatter key 'colour'/);
  assert.doesNotMatch(r.stdout, /'color'/);
});

test("hot read chains stay in budget", () => {
  const got = Object.fromEntries([...run(["--tokens"]).stdout.matchAll(/^ +(\d+)\t(\S+)$/gm)].map((m) => [m[2], +m[1]]));
  for (const [name, max] of [["worker", 1200], ["execute", 6000], ["execute-and-review", 11000]]) {
    assert.ok(got[name] <= max, `${name} read chain over budget: ${got[name]}`);
  }
});

test("budget reports each harness separately", () => withHome((d) => {
  const skills = {
    ".cursor/skills/alpha": "aaaa", ".agents/skills/beta": "bb", ".claude/skills/dup": "cccccc",
    ".claude/plugins/cache/mkt/dup/1.0/skills/dup": "cc",
    ".claude/plugins/cache/m/off/1.0/skills/offskill": "zz",
  };
  for (const [dir, desc] of Object.entries(skills)) {
    write(d, `${dir}/SKILL.md`, `---\nname: ${dir.split("/").pop()}\ndescription: ${desc}\n---\n`);
  }
  write(d, ".codex/skills/hidden/SKILL.md", "---\nname: hidden\ndescription: h\ndisable-model-invocation: true\n---\n");
  write(d, ".claude/settings.json", '{"enabledPlugins":{"dup@mkt":true,"off@m":false}}');
  const out = run(["--budget"], d).stdout;
  assert.match(out, /^cursor: visible=4 description_chars=14 tokens_per_turn=27 duplicates=dup$/m);
  assert.match(out, /^claude: visible=2 description_chars=8 tokens_per_turn=13 duplicates=dup$/m);
}));

test("frontmatter reader handles folded, literal, quoted and list values", () => withHome((d) => {
  write(d, ".cursor/skills/f/SKILL.md", "---\nname: f\ndescription: >\n  ab\n  cd\nallowed-tools:\n  - Read\n  - Grep\n---\n");
  write(d, ".cursor/skills/l/SKILL.md", "---\nname: l\ndescription: |-\n  ab\n  cd\npaths: [a, \"b\"]\n---\n");
  write(d, ".cursor/skills/q/SKILL.md", "---\nname: q\ndescription: 'it''s'\nmetadata:\n  k: v\n---\n");
  write(d, ".cursor/skills/d/SKILL.md", "---\nname: d\ndescription: \"a\\tb\" # note\n---\n");
  assert.match(run(["--budget"], d).stdout, /^cursor: visible=4 description_chars=18 tokens_per_turn=25 duplicates=$/m);
}));

test("prose reports cross-file duplicate", () => withHome((d) => {
  const clause = "Run the full regression suite on the target branch after merging.";
  for (const s of ["a", "b"]) write(d, `${s}/SKILL.md`, `---\nname: ${s}\ndescription: x\n---\n${clause}\n`);
  const out = run(["--prose", d]).stdout;
  assert.match(out, /duplicated clauses .*: 1/);
  assert.match(out, /unresolved links: 0/);
}));
