#!/usr/bin/env node
// Serialize the ship phase of parallel runs on one repo: one lock holder at a time, granted in join order.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const USAGE = `ship-queue: one run lands and deploys at a time; others wait in join order.

  announce <id> --touch p1,p2    record planned paths before executing (overlap warnings only, not a ticket)
  join <id> [--touch p1,p2]      add a ticket when ready to land (idempotent: re-join keeps the original place)
  wait <id> [--poll-ms 5000]     block until this ticket is the oldest live one and the lock is free;
                                 prints GRANTED <id> (exit 0) or HALTED <reason> (exit 3)
  heartbeat <id>                 holder only: refresh lock + ticket; run before and after every long blocking wait
  release <id>                   holder only: drop ticket, lock and announcement; the next ticket gets the lock
  halt <id> --reason TEXT        holder only: release and stop the queue; waiters exit 3
  resume                         clear a halt
  status [<id>] [--touch p1,p2]  holder, waiters with ages, halt state; with --touch, announced runs and
                                 tickets (other than <id>) whose paths overlap by path prefix

Common: --repo DIR (default cwd) --stale-min N (default 120, fractions allowed, must exceed 3x --poll-ms)
A lock or ticket without a heartbeat for --stale-min is reclaimed and logged, and so is an unparseable
file older than 10s. After HALTED, rerunning join + wait keeps the run's place unless its ticket went stale.
Files: <primary checkout>/.worktrees/.andx-run/ship/{ticket-*,inflight-*,lock,halted}.json and log.jsonl
Exit: 0 ok, 2 usage or not joined, 3 halted, 5 not holder.`;

const read = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return e.code === "ENOENT" ? null : undefined;
  }
};
// An unparseable file younger than this is assumed mid-write; older ones are crash leftovers.
const old = (p) => {
  try {
    return Date.now() - fs.statSync(p).mtimeMs > 10000;
  } catch {
    return false;
  }
};
const rm = (p) => fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 50 });
const stamp = () => new Date().toISOString();
const age = (iso) => (Date.now() - Date.parse(iso)) / 60000;
const paths = (s = "") => s.split(",").filter(Boolean).map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""));
const overlaps = (a, b) => a.some((x) => b.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

export function acquire(lock, id) {
  try {
    fs.writeFileSync(lock, JSON.stringify({ id, acquired_at: stamp(), heartbeat: stamp() }), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}

function main(args) {
  let o, cmd, id;
  try {
    ({ values: o, positionals: [cmd, id] } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        repo: { type: "string", default: "." },
        "stale-min": { type: "string", default: "120" },
        "poll-ms": { type: "string", default: "5000" },
        touch: { type: "string" },
        reason: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    fail(2, `${e.message}\n\n${USAGE}`);
  }
  if (o.help) return console.log(USAGE);
  if (!["resume", "status"].includes(cmd) && !id) fail(2, USAGE);
  const staleMin = Number(o["stale-min"]), pollMs = Number(o["poll-ms"]);
  if (!(pollMs > 0) || !(staleMin * 60000 > 3 * pollMs)) fail(2, "--poll-ms must be positive and --stale-min must exceed 3x --poll-ms");
  if (cmd === "announce" && !o.touch) fail(2, "announce needs --touch");
  if (cmd === "halt" && !o.reason) fail(2, "halt needs --reason");

  const g = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: o.repo, encoding: "utf8" });
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo}`);
  const root = path.dirname(g.stdout.trim());
  const dir = path.join(root, ".worktrees", ".andx-run", "ship");
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(dir));
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail(2, `refusing queue dir outside the checkout (symlink?): ${dir}`);

  const stale = (x) => age(x.heartbeat) > staleMin;
  const LOCK = path.join(dir, "lock.json"), HALT = path.join(dir, "halted.json");
  const file = (kind, t) => path.join(dir, `${kind}-${encodeURIComponent(t)}.json`);
  const files = (kind) => fs.readdirSync(dir).filter((f) => f.startsWith(`${kind}-`)).map((f) => path.join(dir, f));
  const write = (p, x) => fs.writeFileSync(p, JSON.stringify(x));
  const log = (event, extra = {}) => fs.appendFileSync(path.join(dir, "log.jsonl"), `${JSON.stringify({ at: stamp(), event, ...extra })}\n`);
  const reclaim = (p, who, kind) => {
    rm(p);
    log("stale-reclaim", { id: who, kind });
    console.log(`reclaimed stale ${kind} ${who}`);
  };
  const byJoin = (a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id);
  const holder = () => {
    const l = read(LOCK);
    if (l?.id !== id) fail(5, `not holder: ${id}`);
    return l;
  };
  const drop = (event, extra) => {
    rm(file("ticket", id));
    rm(LOCK);
    rm(file("inflight", id));
    log(event, { id, ...extra });
  };

  if (cmd === "announce") {
    write(file("inflight", id), { id, at: stamp(), touch: paths(o.touch) });
    console.log(`ANNOUNCED ${id}`);
  } else if (cmd === "join") {
    const p = file("ticket", id);
    let t = read(p);
    for (let i = 0; t === undefined && !old(p) && i < 20; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      t = read(p);
    }
    if (t === undefined && !old(p)) fail(2, `ticket ${id} is being written; retry join`);
    t ??= { id, joined_at: stamp(), touch: [] };
    if (!t.heartbeat) log("join", { id });
    t.heartbeat = stamp();
    if (o.touch !== undefined) t.touch = paths(o.touch);
    write(p, t);
    console.log(`JOINED ${id}`);
  } else if (cmd === "wait") {
    const me = read(file("ticket", id));
    if (!me) fail(2, `not joined: ${id}`);
    const halted = () => {
      const h = read(HALT);
      if (!h) return;
      console.log(`HALTED ${h.reason}`);
      process.exit(3);
    };
    const poll = () => {
      halted();
      me.heartbeat = stamp();
      write(file("ticket", id), me); // also restores the ticket if a peer reclaimed it after a long sleep
      // A ticket mid-write could be older than ours, so granting waits for the next poll.
      let busy = false;
      const queue = [];
      for (const p of files("ticket")) {
        const t = read(p);
        if (t === undefined) {
          if (old(p)) reclaim(p, path.basename(p), "garbage");
          else busy = true;
        } else if (t && t.id !== id && stale(t)) reclaim(p, t.id, "ticket");
        else if (t) queue.push(t);
      }
      if (!busy && queue.sort(byJoin)[0]?.id === id) {
        const l = read(LOCK);
        // Only the head ticket reclaims the lock so waiters do not race on it.
        // Limit: two processes that both think they are head can still double-unlink; a lock generation counter would close that.
        if (l === undefined ? old(LOCK) : l && stale(l)) reclaim(LOCK, l?.id ?? "lock.json", l ? "lock" : "garbage");
        if (acquire(LOCK, id)) {
          if (read(HALT)) rm(LOCK); // halt writes halted.json before freeing the lock, so this catches a halt mid-poll
          halted();
          log("grant", { id });
          console.log(`GRANTED ${id}`);
          process.exit(0);
        }
      }
      setTimeout(poll, pollMs);
    };
    poll();
  } else if (cmd === "heartbeat") {
    write(LOCK, { ...holder(), heartbeat: stamp() });
    const t = read(file("ticket", id));
    if (t) write(file("ticket", id), { ...t, heartbeat: stamp() });
    console.log(`HOLDER ${id}`);
  } else if (cmd === "release") {
    holder();
    drop("release");
    console.log(`RELEASED ${id}`);
  } else if (cmd === "halt") {
    holder();
    write(HALT, { id, reason: o.reason, at: stamp() });
    drop("halt", { reason: o.reason });
    console.log(`HALTED ${o.reason}`);
  } else if (cmd === "resume") {
    rm(HALT);
    log("resume");
    console.log("RESUMED");
  } else if (cmd === "status") {
    const h = read(HALT), l = read(LOCK), queue = files("ticket").map(read).filter((t) => t && !stale(t)).sort(byJoin);
    const m = (iso) => `${Math.round(age(iso))}m`;
    console.log(h ? `halted: ${h.reason} (by ${h.id})` : "halted: no");
    console.log(l ? `holder: ${l.id} held ${m(l.acquired_at)}${stale(l) ? " STALE" : ""}` : "holder: none");
    queue.filter((t) => t.id !== l?.id).forEach((t, i) => console.log(`waiter ${i + 1}: ${t.id} waiting ${m(t.joined_at)}`));
    if (o.touch) {
      // Announcements from runs that died before joining age out after a day.
      const inflight = files("inflight").map(read).filter((x) => x && age(x.at) < 1440);
      const mine = paths(o.touch), shown = new Set([id]);
      for (const x of [...queue, ...inflight]) {
        if (shown.has(x.id) || !overlaps(mine, x.touch)) continue;
        shown.add(x.id);
        console.log(`overlap: ${x.id} ${x.touch.join(",")}`);
      }
    }
  } else fail(2, USAGE);
}

if (import.meta.main) main(process.argv.slice(2));
