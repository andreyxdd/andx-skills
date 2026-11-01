import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, appendFileSync, readFileSync } from "node:fs";
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

test("harness tool names and ~/.cursor/skills paths fail outside HARNESS.md", () => withHome((d) => {
  write(d, "demo/SKILL.md", "---\nname: demo\ndescription: x\n---\nWait with AwaitShell, then run ~/.cursor/skills/demo/x.mjs; Cursor built-ins at ~/.cursor/skills-cursor/ are fine.\n");
  write(d, "demo/HARNESS.md", "Cursor: `Task(subagent_type=\"x\")`, AskQuestion.\n");
  write(d, "agents/a.md", "---\nname: a\ndescription: x\n---\nResume with resume=<id>.\n");
  const r = run([d]);
  assert.equal(r.status, 1);
  const leaks = r.stdout.split("\n").filter((l) => l.includes("harness-specific"));
  assert.deepEqual(leaks.map((l) => l.replace(/;.*/, "")), [
    "error: demo/SKILL.md: harness-specific AwaitShell (line 5)",
    "error: demo/SKILL.md: harness-specific ~/.cursor/skills/ (line 5)",
    "error: agents/a.md: harness-specific resume= (line 5)",
  ]);
}));

const chainTokens = (out) => Object.fromEntries([...out.matchAll(/^ +(\d+)\t(\S+)$/gm)].map((m) => [m[2], +m[1]]));

test("every read chain is within scripts/token-caps.json, and every chain has a cap", () => {
  const r = run(["--tokens"]);
  assert.equal(r.status, 0, r.stdout);
  const caps = JSON.parse(readFileSync(join(here, "token-caps.json"), "utf8")), got = chainTokens(r.stdout);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(caps).filter((k) => k[0] !== "_").sort());
  for (const [name, t] of Object.entries(got)) assert.ok(t <= caps[name], `${name}: ${t} > ${caps[name]}`);
});

test("chains derive from required links, read-by-path mentions and one hop of derived hubs", () => {
  const r = run(["--tokens", join(F, "tokens")]);
  assert.equal(r.status, 0, r.stdout);
  // orchestration is a hub (linked by b, c, d); b/NOTES is not (b, d; links from other/ and the agent don't count).
  // a: a + b (Required line) + orchestration via b; c is a routing link. c: composer with disable-model-invocation.
  // b, d: own links + orchestration + NOTES. w: agent + NOTES via ~ path.
  assert.deepEqual(chainTokens(r.stdout), { a: 94, b: 60, c: 56, d: 59, w: 28 });
  assert.match(r.stdout, /^catalog tokens per turn \(visible skills\): \d+$/m);
});

test("a file linked from a third entry skill becomes a hub", () => withHome((d) => {
  cpSync(join(F, "tokens"), d, { recursive: true });
  appendFileSync(join(d, "andx-c", "SKILL.md"), "Shared: [notes](../andx-b/NOTES.md).\n");
  // a now also gets b/NOTES (24 bytes) through b: (377 + 24) / 4.
  assert.equal(chainTokens(run(["--tokens", d, "--no-caps"]).stdout).a, 100);
}));

test("a new read link raises the chain total and breaks its cap", () => withHome((d) => {
  cpSync(join(F, "tokens"), d, { recursive: true });
  writeFileSync(join(d, "andx-c", "EXTRA.md"), "extra\n");
  appendFileSync(join(d, "andx-c", "SKILL.md"), "Read [extra](./EXTRA.md) first.\n");
  const r = run(["--tokens", d]);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(chainTokens(r.stdout).c, 65);
  assert.match(r.stdout, /^over cap: c 65 > 56$/m);
  assert.equal(run(["--tokens", d, "--no-caps"]).status, 0);
}));

test("a chain without a cap fails", () => withHome((d) => {
  cpSync(join(F, "tokens"), d, { recursive: true });
  writeFileSync(join(d, "scripts", "token-caps.json"), '{"a": 94, "b": 60, "c": 56, "d": 59}');
  const r = run(["--tokens", d]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^over cap: w 28 > none$/m);
}));

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
