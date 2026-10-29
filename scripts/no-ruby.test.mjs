import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/no-ruby.test.mjs";
const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\0").filter(Boolean);

test("git lists tracked files", () => assert.ok(tracked.includes(SELF)));

test("no tracked Ruby or shell scripts", () => {
  assert.deepEqual(tracked.filter((f) => /\.(rb|sh)$/.test(f)), []);
});

test("no ruby invocation in docs, scripts, config or workflows", () => {
  // .cursor/ holds plan and review records whose findings may quote old commands.
  const scanned = tracked.filter((f) => f !== SELF && !f.startsWith(".cursor/") && /\.(md|mjs|json|ya?ml)$/.test(f));
  const hits = scanned.flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n")
    .flatMap((l, i) => (/(^|[^\w-])ruby\s|\/usr\/bin\/ruby/.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : [])));
  assert.deepEqual(hits, []);
});
