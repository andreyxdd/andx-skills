// Three runs share one temp repo and ship through the real queue: join, wait, integrate main, ff-only land, release.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "ship-queue.mjs");
const FAST = ["--poll-ms", "20"];
const BASE = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
let repo, children;

const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const ok = (...a) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...a, "--repo", repo], { encoding: "utf8" });
  assert.equal(r.status, 0, `${a.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
};
const wt = (id) => join(repo, ".worktrees", id);
const branch = (id, file, content) => {
  git(repo, "worktree", "add", "-q", "-b", id, wt(id));
  fs.writeFileSync(join(wt(id), file), content);
  git(wt(id), "add", "-A");
  git(wt(id), "commit", "-q", "-m", id);
};
const landings = () => git(repo, "log", "-g", "--format=%gs", "main").trim().split("\n").filter((s) => s.startsWith("merge")).reverse();
const result = async (c) => {
  const r = await c.done;
  return [r.code, r.out];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in a child process: one run's ship phase. Writes are synchronous so JOINED arrives before wait blocks.
function shipRun() {
  const { spawnSync } = require("node:child_process");
  const { writeSync } = require("node:fs");
  const { script, root, wt, id, after } = JSON.parse(process.env.SHIP_RUN);
  const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8" });
  const q = (...a) => run(process.execPath, [script, ...a, "--poll-ms", "20"], wt);
  const say = (s) => writeSync(1, s);
  process.stdin.once("data", () => {
    q("join", id);
    say("JOINED\n");
    const w = q("wait", id);
    if (w.status !== 0) return say(w.stdout), (process.exitCode = w.status);
    if (run("git", ["merge", "--no-edit", "main"], wt).status !== 0) return say("CONFLICT\n"), (process.exitCode = 1);
    if (run("git", ["merge", "--ff-only", id], root).status !== 0) return say("NOT FAST-FORWARD\n"), (process.exitCode = 1);
    say("LANDED\n");
    if (after === "halt") q("halt", id, "--reason", "deploy health red");
    else q("release", id);
  });
}

const startRun = (id, after) => {
  const env = { ...process.env, SHIP_RUN: JSON.stringify({ script: SCRIPT, root: repo, wt: wt(id), id, after }) };
  const c = spawn(process.execPath, ["--input-type=commonjs", "-e", `(${shipRun})()`], { env });
  let out = "";
  const joined = new Promise((res) => c.stdout.on("data", (d) => (out += d).includes("JOINED") && res()));
  c.done = new Promise((res) => c.on("close", (code) => res({ code, out })));
  c.go = () => (c.stdin.end("go\n"), joined);
  children.push(c);
  return c;
};

// Start every run at once, make them ready in `order` while a gate holds the lock, then open the gate.
async function ship(order, after = {}) {
  ok("join", "gate");
  ok("wait", "gate", ...FAST);
  const runs = Object.fromEntries([...order].sort().map((id) => [id, startRun(id, after[id])]));
  for (const id of order) await runs[id].go();
  ok("release", "gate");
  return runs;
}

beforeEach(() => {
  children = [];
  repo = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "shipq-e2e-")));
  git(repo, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git(repo, "config", k, v);
  fs.writeFileSync(join(repo, "shared.txt"), BASE);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
});
afterEach(() => {
  for (const c of children) c.kill();
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
});

test("runs land in ready order, each a fast-forward after integrating main", { timeout: 60000 }, async () => {
  branch("a", "a.txt", "a\n");
  branch("b", "shared.txt", BASE.replace("2\n", "b\n"));
  branch("c", "shared.txt", BASE.replace("9\n", "c\n"));
  const runs = await ship(["b", "c", "a"]);
  for (const c of Object.values(runs)) assert.deepEqual(await result(c), [0, "JOINED\nLANDED\n"]);
  assert.deepEqual(landings(), ["merge b: Fast-forward", "merge c: Fast-forward", "merge a: Fast-forward"]);
  assert.equal(fs.readFileSync(join(repo, "shared.txt"), "utf8"), "1\nb\n3\n4\n5\n6\n7\n8\nc\n10\n");
  assert.equal(fs.readFileSync(join(repo, "a.txt"), "utf8"), "a\n");
});

test("a conflicting integrate keeps the lock and nothing lands until it is released", { timeout: 60000 }, async () => {
  branch("x", "shared.txt", BASE.replace("5\n", "x\n"));
  branch("y", "shared.txt", BASE.replace("5\n", "y\n"));
  branch("z", "z.txt", "z\n");
  const runs = await ship(["x", "y", "z"]);
  assert.deepEqual(await result(runs.y), [1, "JOINED\nCONFLICT\n"]);
  await sleep(500);
  assert.equal(runs.z.exitCode, null);
  assert.match(ok("status"), /^holder: y held 0m\nwaiter 1: z waiting 0m$/m);
  assert.deepEqual(landings(), ["merge x: Fast-forward"]);
  ok("release", "y");
  assert.deepEqual(await result(runs.z), [0, "JOINED\nLANDED\n"]);
  assert.deepEqual(landings(), ["merge x: Fast-forward", "merge z: Fast-forward"]);
});

test("a halt by the holder stops the remaining runs", { timeout: 60000 }, async () => {
  branch("p", "p.txt", "p\n");
  branch("q", "q.txt", "q\n");
  branch("r", "r.txt", "r\n");
  const runs = await ship(["p", "q", "r"], { p: "halt" });
  assert.deepEqual(await result(runs.p), [0, "JOINED\nLANDED\n"]);
  for (const id of ["q", "r"]) assert.deepEqual(await result(runs[id]), [3, "JOINED\nHALTED deploy health red\n"]);
  assert.deepEqual(landings(), ["merge p: Fast-forward"]);
});
