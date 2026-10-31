import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PROJ = join(here, "fixtures", "spend", "secret-proj");

function run(...args) {
  const r = spawnSync(process.execPath, [join(here, "spend-report.mjs"), ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout + r.stderr;
}

test("single run counts parent and both subagent layouts", () => {
  const out = run(join(PROJ, "s1.jsonl"));
  assert.match(out, /^run s1$/m);
  assert.match(out, /requests parent=2 subagent=2$/m);
  assert.match(out, /input parent=2415 subagent=803 total=3218$/m);
  assert.match(out, /output parent=70 subagent=15$/m);
  assert.match(out, /peak_context parent=1305 subagent=501$/m);
  assert.match(out, /image_results 1$/m);
  assert.match(out, /top_tool_output Read=100 Bash=20 Grep=10$/m);
  // uncached 10+5+1+2, write 100+200+0+300, read 1000+1100+500+0, output 85
  assert.match(out, /^  cache input_uncached=18 cache_write=600 cache_read=2600$/m);
  // 18*1 + 600*1.25 + 2600*0.1 + 85*5 = 18 + 750 + 260 + 425
  assert.match(out, /^  cost_units 1453$/m);
});

test("help documents the cost weights", () => {
  const out = run("--help");
  assert.match(out, /uncached\s*[×x*]\s*1\b/);
  assert.match(out, /write\s*[×x*]\s*1\.25\b/);
  assert.match(out, /read\s*[×x*]\s*0\.1\b/);
  assert.match(out, /output\s*[×x*]\s*5\b/);
  assert.match(out, /model mix/i);
});

test("dir lists only andx runs", () => {
  assert.deepEqual([...run(PROJ).matchAll(/^run (\S+)$/gm)].map((m) => m[1]).sort(), ["s1", "s2", "s4"]);
});

test("summary prints medians, totals and no project names", () => {
  const out = run("--summary", dirname(PROJ));
  assert.match(out, /^runs 3$/m);
  assert.match(out, /^median .*input_total=3218\b/m);
  assert.match(out, /^median .*requests_parent=1\b/m);
  assert.match(out, /^total .*input_total=9218\b/m);
  // runs cost 1453 (s1), 405 (s2: 4000*0.1 + 1*5), 205 (s4: 2000*0.1 + 1*5)
  assert.match(out, /^median .*cache_read=2600 cost_units=405\b/m);
  assert.match(out, /^median .*input_uncached=0 cache_write=0\b/m);
  assert.match(out, /^total .*input_uncached=18 cache_write=600 cache_read=8600 cost_units=2063\b/m);
  // 8600 / 9218
  assert.match(out, /^cache_read_share 0\.933$/m);
  assert.doesNotMatch(out, /secret-proj/);
  assert.doesNotMatch(out, /\bs[1-5]\b/);
});

test("summary prints medians per first invoked skill", () => {
  const out = run("--summary", dirname(PROJ));
  assert.match(out, /^andx-execute runs=1 median input_total=3218 output=85 cost_units=1453$/m);
  assert.match(out, /^andx-plan runs=2 median input_total=3000 output=1 cost_units=305$/m);
});

test("unreadable directory is counted, other runs still reported", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const root = mkdtempSync(join(tmpdir(), "spend-"));
  const locked = join(root, "secret-proj", "locked-dir");
  try {
    mkdirSync(locked, { recursive: true });
    copyFileSync(join(PROJ, "s2.jsonl"), join(root, "secret-proj", "s2.jsonl"));
    chmodSync(locked, 0);
    const out = run(join(root, "secret-proj"));
    assert.match(out, /^run s2$/m);
    assert.match(out, /^skipped 1 unreadable files$/m);
    assert.doesNotMatch(out, /secret-proj|locked-dir/);
  } finally {
    chmodSync(locked, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test("unreadable transcript is skipped without naming it", () => {
  const root = mkdtempSync(join(tmpdir(), "spend-"));
  try {
    const proj = join(root, "secret-proj");
    mkdirSync(join(proj, "missing-target.jsonl"), { recursive: true });
    copyFileSync(join(PROJ, "s2.jsonl"), join(proj, "s2.jsonl"));
    for (const out of [run(proj), run("--summary", root)]) {
      assert.match(out, /^skipped 1 unreadable files$/m);
      assert.doesNotMatch(out, /secret-proj|missing-target/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
