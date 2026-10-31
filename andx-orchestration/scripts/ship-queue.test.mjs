import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "./ship-queue.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "ship-queue.mjs");
const FAST = ["--poll-ms", "20"];
let repo;

const q = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--repo", repo], { encoding: "utf8" });
const ok = (...a) => {
  const r = q(...a);
  assert.equal(r.status, 0, `${a.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
};
const waitAsync = (id, ...a) => {
  const c = spawn(process.execPath, [SCRIPT, "wait", id, ...FAST, ...a, "--repo", repo]);
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.done = new Promise((res) => c.on("close", (code) => res({ id, code, out })));
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => fs.readFileSync(join(repo, ".worktrees", ".andx-run", "ship", "log.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "shipq-")));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test("concurrent waiters are granted strictly in join order", async () => {
  for (const id of ["feat/c", "feat/a", "feat/b"]) ok("join", id);
  const pending = new Map(["feat/a", "feat/b", "feat/c"].map((id) => [id, waitAsync(id).done]));
  const granted = [];
  while (pending.size) {
    const r = await Promise.race(pending.values());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`^GRANTED ${r.id}$`, "m"));
    granted.push(r.id);
    pending.delete(r.id);
    ok("release", r.id);
  }
  assert.deepEqual(granted, ["feat/c", "feat/a", "feat/b"]);
  assert.deepEqual(log().filter((e) => e.event === "grant").map((e) => e.id), granted);
});

test("a second waiter blocks until the holder releases", async () => {
  ok("join", "a");
  ok("join", "b");
  assert.equal(ok("wait", "a", ...FAST), "GRANTED a\n");
  let exited = false;
  const b = waitAsync("b");
  b.done.then(() => (exited = true));
  await sleep(400);
  assert.equal(exited, false);
  assert.match(ok("status"), /^holder: a held 0m\nwaiter 1: b waiting 0m$/m);
  ok("release", "a");
  const r = await b.done;
  assert.deepEqual([r.code, r.out], [0, "GRANTED b\n"]);
});

test("a stale lock and ticket are reclaimed and logged", async () => {
  ok("join", "dead");
  ok("wait", "dead", ...FAST);
  ok("join", "live");
  const r = await waitAsync("live", "--stale-min", "0.003").done;
  assert.match(r.out, /^reclaimed stale ticket dead\nreclaimed stale lock dead\nGRANTED live$/m);
  assert.deepEqual(
    log().filter((e) => e.event === "stale-reclaim").map((e) => [e.kind, e.id]),
    [["ticket", "dead"], ["lock", "dead"]],
  );
});

test("halt stops waiters with exit 3 and resume clears it", async () => {
  ok("join", "a");
  ok("join", "b");
  ok("wait", "a", ...FAST);
  const b = waitAsync("b");
  ok("halt", "a", "--reason", "deploy health red");
  const r = await b.done;
  assert.deepEqual([r.code, r.out], [3, "HALTED deploy health red\n"]);
  assert.equal(ok("status"), "halted: deploy health red (by a)\nholder: none\nwaiter 1: b waiting 0m\n");
  ok("resume");
  assert.match(ok("status"), /^halted: no$/m);
  assert.equal(ok("wait", "b", ...FAST), "GRANTED b\n");
});

test("status --touch lists live tickets with overlapping paths", () => {
  ok("join", "api", "--touch", "src/api,docs/x.md");
  ok("join", "lib", "--touch", "lib/");
  ok("join", "apix", "--touch", "src/apix");
  const out = ok("status", "--touch", "src/api/users.ts,lib");
  assert.match(out, /^overlap: api src\/api,docs\/x.md\noverlap: lib lib$/m);
  assert.doesNotMatch(out, /overlap: apix/);
});

test("release and halt by a non-holder exit 5", () => {
  ok("join", "a");
  ok("join", "b");
  assert.equal(q("release", "a").status, 5);
  ok("wait", "a", ...FAST);
  assert.equal(q("release", "b").status, 5);
  assert.equal(q("halt", "b", "--reason", "x").status, 5);
  assert.equal(ok("heartbeat", "a"), "HOLDER a\n");
  assert.equal(q("heartbeat", "b").status, 5);
});

test("join is idempotent and keeps the original place", () => {
  ok("join", "a");
  ok("join", "b");
  ok("join", "a", "--touch", "x");
  assert.equal(ok("wait", "a", ...FAST), "GRANTED a\n");
  assert.equal(log().filter((e) => e.event === "join").length, 2);
});

test("worktrees of one repo share the queue", () => {
  const g = (...a) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo });
  g("commit", "-q", "--allow-empty", "-m", "init");
  g("worktree", "add", "-q", "-b", "feat", join(repo, ".worktrees", "feat"));
  const r = spawnSync(process.execPath, [SCRIPT, "join", "feat", "--repo", join(repo, ".worktrees", "feat")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(ok("status"), /^waiter 1: feat waiting 0m$/m);
});

test("usage errors exit 2: wait without join, stale window not above 3x poll", () => {
  assert.equal(q("wait", "nobody", ...FAST).status, 2);
  assert.equal(q("status", "--stale-min", "0.001", "--poll-ms", "20").status, 2);
  assert.equal(q("status", "--stale-min", "0.0011", "--poll-ms", "20").status, 0);
});

test("lock creation is exclusive", () => {
  const lock = join(repo, "lock.json");
  assert.equal(acquire(lock, "a"), true);
  assert.equal(acquire(lock, "b"), false);
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).id, "a");
});

const SHIP = () => join(repo, ".worktrees", ".andx-run", "ship");
const corrupt = (name, ageMs) => {
  const p = join(SHIP(), name);
  fs.writeFileSync(p, "{\"id\":");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(p, t, t);
};

test("old unparseable lock and ticket files are reclaimed, young ones are left alone", async () => {
  ok("join", "a");
  corrupt("lock.json", 2000);
  const kid = waitAsync("a");
  await sleep(300);
  assert.equal(kid.exitCode, null);
  kid.kill();
  await kid.done;
  corrupt("lock.json", 60000);
  corrupt("ticket-crashed.json", 60000);
  assert.equal(ok("wait", "a", ...FAST), "reclaimed stale garbage ticket-crashed.json\nreclaimed stale garbage lock.json\nGRANTED a\n");
  assert.equal(log().filter((e) => e.kind === "garbage").length, 2);
});

test("join replaces an old unparseable own ticket but never a young one", () => {
  ok("status");
  corrupt("ticket-a.json", 2000);
  assert.equal(q("join", "a").status, 2);
  assert.equal(fs.readFileSync(join(SHIP(), "ticket-a.json"), "utf8"), "{\"id\":");
  corrupt("ticket-a.json", 60000);
  ok("join", "a");
  assert.equal(ok("wait", "a", ...FAST), "GRANTED a\n");
});

test("announce feeds status --touch, the caller is excluded, release clears it", () => {
  ok("announce", "feat/one", "--touch", "src/api");
  ok("announce", "feat/two", "--touch", "src/api/x.ts");
  ok("join", "feat/three", "--touch", "src");
  assert.equal(q("announce", "feat/four").status, 2);
  const out = ok("status", "feat/two", "--touch", "src/api/x.ts");
  assert.match(out, /^overlap: feat\/three src\noverlap: feat\/one src\/api\n$/m);
  assert.doesNotMatch(out, /feat\/two/);
  assert.equal(log().filter((e) => e.event === "join").length, 1);
  ok("wait", "feat/three", ...FAST);
  ok("release", "feat/three");
  ok("join", "feat/one");
  ok("wait", "feat/one", ...FAST);
  ok("halt", "feat/one", "--reason", "x");
  assert.doesNotMatch(ok("status", "--touch", "src"), /overlap: feat\/(one|three)/);
});

test("a queue dir that escapes the checkout through a symlink is refused", () => {
  const outside = fs.mkdtempSync(join(tmpdir(), "shipq-out-"));
  try {
    fs.symlinkSync(outside, join(repo, ".worktrees"), "junction");
    const r = q("status");
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /symlink/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
