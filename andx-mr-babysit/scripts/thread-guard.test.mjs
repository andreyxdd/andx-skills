import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BEFORE = [
  { id: "h1", author: "alice", resolved: false },
  { id: "b1", author: "cursor[bot]", resolved: false },
  { id: "b2", author: "aikido-security-bot", resolved: false },
  { id: "h2", author: "bob", resolved: true },
];
const after = (ids) => BEFORE.map((t) => ({ ...t, resolved: t.resolved || ids.includes(t.id) }));

function guard(before, afterList, ...extra) {
  const dir = mkdtempSync(join(tmpdir(), "thread-guard-"));
  try {
    const b = join(dir, "before.json");
    const a = join(dir, "after.json");
    writeFileSync(b, JSON.stringify(before));
    writeFileSync(a, JSON.stringify(afterList));
    const r = spawnSync(process.execPath, [join(here, "thread-guard.mjs"), b, a, ...extra], { encoding: "utf8" });
    return { code: r.status, out: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("bot threads may be resolved", () => {
  assert.deepEqual(guard(BEFORE, after(["b1", "b2"])), { code: 0, out: "thread-guard: PASS\n" });
});

test("human thread resolution is flagged", () => {
  assert.deepEqual(guard(BEFORE, after(["b1", "h1"])), { code: 1, out: "thread-guard: FAIL human threads resolved by agent: h1\n" });
});

test("extra bot allowlist", () => {
  const before = [{ id: "x", author: "renovate", resolved: false }];
  const resolved = [{ id: "x", author: "renovate", resolved: true }];
  assert.equal(guard(before, resolved).code, 1);
  assert.equal(guard(before, resolved, "--bots", "renovate").code, 0);
});
