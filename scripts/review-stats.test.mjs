import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, stats } from "./review-stats.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "fixtures", "review-stats");

const run = (...args) => spawnSync(process.execPath, [join(here, "review-stats.mjs"), ...args], { encoding: "utf8" });

// Hand-counted from the two fixtures: aliases fold, rejected findings only count as rejected.
const EXPECTED = [
  "bugbot findings=2 unique=1 high_unique=1 rejected=1",
  "ponytail findings=2 unique=1 high_unique=1 rejected=0",
  "security findings=3 unique=2 high_unique=0 rejected=0",
  "spec findings=1 unique=0 high_unique=0 rejected=0",
  "total files=2 findings=7 unique=4 high_unique=2 rejected=1",
].join("\n") + "\n";

test("dir: one line per canonical reviewer plus total", () => {
  const r = run(DIR);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, EXPECTED);
});

test("explicit files match the dir scan", () => {
  const r = run(join(DIR, "b-v2.json"), join(DIR, "a-v1.json"));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, EXPECTED);
});

test("stats() returns the same counts", () => {
  const artifacts = ["a-v1.json", "b-v2.json"].map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));
  assert.deepEqual(stats(artifacts), {
    files: 2,
    reviewers: {
      "bugbot": { findings: 2, unique: 1, high_unique: 1, rejected: 1 },
      "ponytail": { findings: 2, unique: 1, high_unique: 1, rejected: 0 },
      "security": { findings: 3, unique: 2, high_unique: 0, rejected: 0 },
      "spec": { findings: 1, unique: 0, high_unique: 0, rejected: 0 },
    },
    total: { findings: 7, unique: 4, high_unique: 2, rejected: 1 },
  });
});

test("canonical() folds reviewer aliases", () => {
  assert.deepEqual(
    ["Ponytail-Review", "cursor security-review", "andx-spec-reviewer", "ponytail-audit", "ux-api"].map(canonical),
    ["ponytail", "security", "spec", "audit", "ux-api"],
  );
});

test("unreadable or non-artifact input exits 1 naming the file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "review-stats-"));
  try {
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "{not json");
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /bad\.json/);
    writeFileSync(bad, JSON.stringify({ schema_version: 2 }));
    assert.equal(run(bad).status, 1);
    assert.equal(run().status, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
