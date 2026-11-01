import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refs } from "./ship-queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ship-queue.mjs");
const RUN = join(HERE, "run.mjs");
const FAST = ["--poll-ms", "20"];
const TEST_OK = "node -e 0";
let repo;

const q = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--repo", repo], { encoding: "utf8" });
const ok = (...a) => {
  const r = q(...a);
  assert.equal(r.status, 0, `${a.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
};
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const shipRefs = () => git(repo, "for-each-ref", "--format=%(refname)", "refs/andx/ship/").split("\n").filter(Boolean);
const waitAsync = (id, ...a) => {
  const c = spawn(process.execPath, [SCRIPT, "wait", id, ...FAST, ...a, "--repo", repo]);
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.done = new Promise((res) => c.on("close", (code) => res({ id, code, out, c })));
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A branch in its own worktree with one commit writing `file`.
const branch = (id, file, content) => {
  const dir = join(repo, ".worktrees", id);
  git(repo, "worktree", "add", "-q", "-b", id, dir);
  fs.writeFileSync(join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", id);
  return dir;
};
const hold = (id) => {
  ok("join", id);
  return ok("wait", id, ...FAST);
};

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "shipq-")));
  git(repo, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git(repo, "config", k, v);
  fs.writeFileSync(join(repo, "shared.txt"), "1\n2\n3\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 }));

test("concurrent waiters are granted strictly in join order, one generation each", async () => {
  for (const id of ["feat/c", "feat/a", "feat/b"]) ok("join", id);
  const pending = new Map(["feat/a", "feat/b", "feat/c"].map((id) => [id, waitAsync(id).done]));
  const granted = [];
  while (pending.size) {
    const r = await Promise.race(pending.values());
    assert.equal(r.code, 0, r.out);
    granted.push(r.out.trim());
    pending.delete(r.id);
    ok("release", r.id);
  }
  assert.deepEqual(granted, ["GRANTED feat/c gen 1", "GRANTED feat/a gen 2", "GRANTED feat/b gen 3"]);
});

test("a second waiter blocks until the holder releases", async () => {
  ok("join", "a");
  ok("join", "b");
  assert.equal(ok("wait", "a", ...FAST), "GRANTED a gen 1\n");
  let exited = false;
  const b = waitAsync("b");
  b.done.then(() => (exited = true));
  await sleep(400);
  assert.equal(exited, false);
  assert.match(ok("status"), /^holder: a gen 1 held 0m\nwaiter 1: b waiting 0m$/m);
  ok("release", "a");
  const r = await b.done;
  assert.deepEqual([r.code, r.out], [0, "GRANTED b gen 2\n"]);
});

test("queue state lives in refs/andx/ship with hex-encoded ids and no queue files", () => {
  ok("announce", "feat/a", "--touch", "src");
  ok("join", "feat/a");
  ok("join", "b");
  assert.deepEqual(shipRefs(), ["refs/andx/ship/announce/666561742f61", "refs/andx/ship/ticket/62", "refs/andx/ship/ticket/666561742f61"]);
  ok("wait", "feat/a", ...FAST);
  assert.deepEqual(shipRefs(), ["refs/andx/ship/announce/666561742f61", "refs/andx/ship/lock", "refs/andx/ship/ticket/62"]);
  assert.deepEqual(JSON.parse(git(repo, "cat-file", "blob", "refs/andx/ship/lock")).gen, 1);
  assert.equal(fs.existsSync(join(repo, ".worktrees", ".andx-run", "ship")), false);
});

test("compare-and-swap writes refuse a stale old value", () => {
  const r = refs(repo);
  const name = "refs/andx/ship/ticket/78";
  const first = r.cas(name, { v: 1 }, "");
  assert.match(first, /^[0-9a-f]{40,64}$/);
  assert.equal(r.cas(name, { v: 2 }, ""), null);
  const second = r.cas(name, { v: 2 }, first);
  assert.ok(second);
  assert.equal(r.cas(name, { v: 3 }, first), null);
  assert.equal(r.del(name, first), false);
  assert.deepEqual(JSON.parse(git(repo, "cat-file", "blob", name)), { v: 2 });
  assert.equal(r.del(name, second), true);
  assert.deepEqual(shipRefs(), []);
});

test("a stale lock and a stale waiter ticket are reclaimed", async () => {
  hold("dead");
  ok("join", "gone");
  ok("join", "live");
  await sleep(300);
  const r = await waitAsync("live", "--stale-min", "0.003").done;
  assert.equal(r.out, "reclaimed stale ticket gone\nreclaimed stale lock dead\nGRANTED live gen 2\n");
  assert.equal(q("heartbeat", "dead").status, 5);
});

test("two processes that read the same lock: exactly one takes the next generation", async () => {
  hold("dead");
  const src = `import { refs, takeLock } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
    const r = refs(process.env.REPO), s = r.snapshot();
    process.stdout.write("READ\\n");
    process.stdin.once("data", () => console.log(takeLock(r, s, process.env.ID) ? "GRANTED" : "LOST"));`;
  const kids = ["p", "q"].map((ID) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", src], { env: { ...process.env, REPO: repo, ID } });
    let out = "";
    c.read = new Promise((res) => c.stdout.on("data", (d) => (out += d).includes("READ") && res()));
    c.done = new Promise((res) => c.on("close", () => res(out.replace("READ\n", "").trim())));
    return c;
  });
  await Promise.all(kids.map((c) => c.read));
  for (const c of kids) c.stdin.end("go\n");
  assert.deepEqual((await Promise.all(kids.map((c) => c.done))).sort(), ["GRANTED", "LOST"]);
  assert.equal(JSON.parse(git(repo, "cat-file", "blob", "refs/andx/ship/lock")).gen, 2);
});

// Duplicate waits for one id (a resumed chat re-running wait) are all head of the queue and race for the lock.
test("waits racing for one stale lock never share a generation", { timeout: 30000 }, async () => {
  hold("dead");
  for (let round = 0; round < 3; round++) {
    ok("join", "dup");
    const racers = Array.from({ length: 6 }, () => waitAsync("dup", "--stale-min", "0.003"));
    const first = await Promise.race(racers.map((c) => c.done));
    for (const c of racers) if (c !== first.c) c.kill();
    const outs = await Promise.all(racers.map((c) => c.done));
    const gens = outs.flatMap((r) => [...r.out.matchAll(/^GRANTED dup gen (\d+)$/gm)].map((m) => m[1]));
    assert.ok(gens.length >= 1, outs.map((r) => r.out).join("|"));
    assert.equal(new Set(gens).size, gens.length, `generation granted twice: ${gens}`);
  }
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
  assert.equal(ok("wait", "b", ...FAST), "GRANTED b gen 2\n");
});

test("status --touch lists live tickets with overlapping paths", () => {
  ok("join", "api", "--touch", "src/api,docs/x.md");
  ok("join", "lib", "--touch", "lib/");
  ok("join", "apix", "--touch", "src/apix");
  const out = ok("status", "--touch", "src/api/users.ts,lib");
  assert.match(out, /^overlap: api src\/api,docs\/x.md\noverlap: lib lib$/m);
  assert.doesNotMatch(out, /overlap: apix/);
});

test("holder commands from a non-holder or a stale generation exit 5", () => {
  ok("join", "a");
  ok("join", "b");
  assert.equal(q("release", "a").status, 5);
  ok("wait", "a", ...FAST);
  assert.equal(q("release", "b").status, 5);
  assert.equal(q("halt", "b", "--reason", "x").status, 5);
  assert.equal(q("land", "b", "--worktree", repo, "--target", "main", "--test", TEST_OK).status, 5);
  assert.equal(ok("heartbeat", "a", "--gen", "1"), "HOLDER a gen 1\n");
  assert.equal(q("heartbeat", "b").status, 5);
  ok("release", "a");
  ok("leave", "b");
  assert.equal(hold("a"), "GRANTED a gen 2\n");
  const r = q("heartbeat", "a", "--gen", "1");
  assert.equal(r.status, 5);
  assert.match(r.stderr, /stale generation/);
  assert.equal(q("release", "a", "--gen", "1").status, 5);
  ok("release", "a", "--gen", "2");
});

test("join is idempotent and keeps the original place", () => {
  ok("join", "a");
  ok("join", "b");
  ok("join", "a", "--touch", "x");
  assert.equal(ok("wait", "a", ...FAST), "GRANTED a gen 1\n");
});

test("leave drops the caller's ticket; wait leaves on SIGTERM", { skip: process.platform === "win32" }, async () => {
  hold("h");
  ok("join", "a");
  ok("join", "b");
  assert.equal(ok("leave", "a"), "LEFT a\n");
  assert.equal(ok("status"), "halted: no\nholder: h gen 1 held 0m\nwaiter 1: b waiting 0m\n");
  const w = waitAsync("b");
  await sleep(300);
  w.kill("SIGTERM");
  await w.done;
  assert.equal(ok("status"), "halted: no\nholder: h gen 1 held 0m\n");
});

test("worktrees of one repo share the queue", () => {
  const dir = branch("feat", "f.txt", "f\n");
  const r = spawnSync(process.execPath, [SCRIPT, "join", "feat", "--repo", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(ok("status"), /^waiter 1: feat waiting 0m$/m);
});

test("usage errors exit 2: wait without join, stale window not above 3x poll", () => {
  assert.equal(q("wait", "nobody", ...FAST).status, 2);
  assert.equal(q("status", "--stale-min", "0.001", "--poll-ms", "20").status, 2);
  assert.equal(q("status", "--stale-min", "0.0011", "--poll-ms", "20").status, 0);
  assert.equal(q("land", "x", "--worktree", repo).status, 2);
});

test("announce feeds status --touch, the caller is excluded, release clears it", () => {
  ok("announce", "feat/one", "--touch", "src/api");
  ok("announce", "feat/two", "--touch", "src/api/x.ts");
  ok("join", "feat/three", "--touch", "src");
  assert.equal(q("announce", "feat/four").status, 2);
  const out = ok("status", "feat/two", "--touch", "src/api/x.ts");
  assert.match(out, /^overlap: feat\/three src\noverlap: feat\/one src\/api\n$/m);
  assert.doesNotMatch(out, /feat\/two/);
  ok("wait", "feat/three", ...FAST);
  ok("release", "feat/three");
  ok("join", "feat/one");
  ok("wait", "feat/one", ...FAST);
  ok("halt", "feat/one", "--reason", "x");
  assert.doesNotMatch(ok("status", "--touch", "src"), /overlap: feat\/(one|three)/);
});

test("join refuses a branch that conflicts with the target and does not queue it", () => {
  branch("feat", "shared.txt", "1\nfeat\n3\n");
  fs.writeFileSync(join(repo, "shared.txt"), "1\nmain\n3\n");
  git(repo, "commit", "-q", "-am", "main edit");
  const r = q("join", "feat", "--target", "main");
  assert.deepEqual([r.status, r.stdout], [6, "CONFLICT shared.txt\n"]);
  assert.deepEqual(shipRefs(), []);
  branch("clean", "c.txt", "c\n");
  assert.equal(ok("join", "clean", "--target", "main"), "JOINED clean\n");
});

test("land: a conflicting integrate is aborted with exit 6 and the lock is kept", () => {
  const dir = branch("feat", "shared.txt", "1\nfeat\n3\n");
  fs.writeFileSync(join(repo, "shared.txt"), "1\nmain\n3\n");
  git(repo, "commit", "-q", "-am", "main edit");
  const main = git(repo, "rev-parse", "main");
  hold("feat");
  const r = q("land", "feat", "--worktree", dir, "--target", "main", "--test", TEST_OK);
  assert.deepEqual([r.status, r.stdout], [6, "CONFLICT shared.txt\n"]);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(repo, "rev-parse", "main"), main);
  assert.match(ok("status"), /^holder: feat gen 1/m);
});

test("land: a failing test after a changing integrate exits 8, lock kept, nothing lands", () => {
  const dir = branch("feat", "f.txt", "f\n");
  fs.writeFileSync(join(repo, "m.txt"), "m\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "main moved");
  const main = git(repo, "rev-parse", "main");
  hold("feat");
  const r = q("land", "feat", "--worktree", dir, "--target", "main", "--test", "node -e \"process.exit(3)\"");
  assert.equal(r.status, 8, r.stderr);
  assert.equal(git(repo, "rev-parse", "main"), main);
  assert.match(ok("status"), /^holder: feat gen 1 held 0m$/m);
});

test("land refuses a --worktree that is the primary checkout with exit 2 and changes nothing", () => {
  branch("feat", "f.txt", "f\n");
  const main = git(repo, "rev-parse", "main");
  hold("feat");
  for (const dir of [repo, join(repo, ".")]) {
    const r = q("land", "feat", "--worktree", dir, "--target", "main", "--test", TEST_OK);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /linked worktree/);
  }
  assert.equal(git(repo, "rev-parse", "HEAD"), main);
  assert.equal(git(repo, "status", "--porcelain", "--untracked-files=no"), "");
  assert.match(ok("status"), /^holder: feat gen 1 held 0m$/m);
});

test("land: a lock lost while the test runs exits 5 and nothing lands", () => {
  const dir = branch("feat", "f.txt", "f\n");
  fs.writeFileSync(join(repo, "m.txt"), "m\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "main moved");
  const main = git(repo, "rev-parse", "main");
  hold("feat");
  const steal = `"${process.execPath}" "${SCRIPT}" release feat --repo "${repo}"`;
  const r = q("land", "feat", "--worktree", dir, "--target", "main", "--test", steal);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.equal(git(repo, "rev-parse", "main"), main);
});

test("land fast-forwards the primary checkout on target, records the ledger, then release needs --after-deploy", () => {
  const vars = Object.fromEntries(spawnSync(process.execPath, [RUN, "start", "--slug", "s", "--mode", "execute", "--repo", repo], { encoding: "utf8" })
    .stdout.trim().split("\n").map((l) => l.split("=")));
  git(repo, "worktree", "add", "-q", "-b", vars.EXEC_BRANCH, vars.WORKTREE_DIR);
  fs.writeFileSync(join(vars.WORKTREE_DIR, "f.txt"), "f\n");
  git(vars.WORKTREE_DIR, "add", "-A");
  git(vars.WORKTREE_DIR, "commit", "-q", "-m", "feat");
  const id = vars.SHIP_ID;
  hold(id);
  assert.equal(q("release", id, "--after-deploy").status, 2);
  const other = branch("other", "o.txt", "o\n");
  const wrong = q("land", id, "--worktree", other, "--test", TEST_OK);
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /WORKTREE_DIR/);
  const marker = join(repo, ".worktrees", "tested");
  const out = ok("land", id, "--worktree", vars.WORKTREE_DIR, "--test", `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}', '')"`);
  const sha = git(repo, "rev-parse", "main");
  assert.equal(sha, git(vars.WORKTREE_DIR, "rev-parse", "HEAD"));
  assert.equal(out, `LANDED ${id} ${sha}\nLANDED s ${sha}\n`);
  assert.equal(fs.existsSync(marker), false, "integrate was a no-op, so the test must not run");
  assert.equal(fs.readFileSync(join(repo, "f.txt"), "utf8"), "f\n");
  assert.equal(JSON.parse(fs.readFileSync(join(repo, ".worktrees", ".andx-run", "s.json"), "utf8")).landed, sha);
  const r = q("release", id);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /LANDED, use halt or release --after-deploy/);
  assert.equal(ok("release", id, "--after-deploy"), `RELEASED ${id}\n`);
});

test("land with a detached primary moves the target ref only, unless the target is checked out elsewhere", () => {
  const dir = branch("feat", "f.txt", "f\n");
  git(repo, "switch", "-q", "--detach", "main");
  hold("feat");
  git(repo, "worktree", "add", "-q", join(repo, ".worktrees", "main-wt"), "main");
  const r = q("land", "feat", "--worktree", dir, "--target", "main", "--test", TEST_OK);
  assert.equal(r.status, 9);
  assert.match(r.stderr, /main checked out elsewhere/);
  git(repo, "worktree", "remove", join(repo, ".worktrees", "main-wt"));
  const out = ok("land", "feat", "--worktree", dir, "--target", "main", "--test", TEST_OK);
  const sha = git(dir, "rev-parse", "HEAD");
  assert.equal(git(repo, "rev-parse", "main"), sha);
  assert.match(out, new RegExp(`^LANDED feat ${sha}$`, "m"));
  assert.equal(fs.existsSync(join(repo, "f.txt")), false);
  assert.equal(git(repo, "branch", "--show-current"), "");
});
