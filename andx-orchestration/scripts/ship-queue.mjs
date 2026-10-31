#!/usr/bin/env node
// Serialize the ship phase of parallel runs on one repo: one lock holder at a time, granted in join order.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const USAGE = `ship-queue: one run lands and deploys at a time; others wait in join order.

  join <id> [--touch p1,p2]      add a ticket (idempotent: re-join keeps the original place)
  wait <id> [--poll-ms 5000] [--timeout-min N]
                                 block until this ticket is the oldest live one and the lock is free
                                 prints GRANTED <id> (0) | HALTED <reason> (3) | TIMEOUT (4)
  heartbeat <id>                 refresh the lock (holder) or ticket (waiter); run at every phase boundary
  release <id> [--status DONE|FAILED]
                                 holder only: drop lock + ticket, next ticket gets the lock
  halt <id> --reason TEXT        holder only: drop lock + ticket and stop the queue; waiters exit 3
  resume                         clear a halt
  status [--touch p1,p2]         holder, waiters with ages, halt state; with --touch, live tickets
                                 whose recorded touch paths overlap by path prefix

Flow: join when the run is ready to land (completion order wins), then wait in one background shell.
Holder heartbeats at each phase boundary (integrate, land, push, deploy, health), releases after
cleanup (or fresh health output when deploying), and halts with the blocker after the final failed
fix attempt. HALTED or TIMEOUT: stop, report status, wait for the user (resume clears a halt).
wait leaves the ticket in place, so rerunning join + wait keeps the run's place.

Common: --repo DIR (default cwd) --stale-min N (default 60; fractions allowed)
A lock or ticket without a heartbeat for --stale-min is reclaimed and logged.
Files: <primary checkout>/.worktrees/.andx-run/ship/{ticket-*.json,lock.json,halted.json,log.jsonl}
Exit: 0 ok, 2 usage or not joined, 3 halted, 4 timeout, 5 not holder.`;

const read = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return e.code === "ENOENT" ? null : undefined; // undefined = mid-write, try again next poll
  }
};
const rm = (p) => fs.rmSync(p, { force: true });
const age = (iso) => (Date.now() - Date.parse(iso)) / 60000;
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const overlaps = (a, b) => a.some((x) => b.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

function main(args) {
  let o, cmd, id;
  try {
    ({ values: o, positionals: [cmd, id] } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        repo: { type: "string", default: "." },
        "stale-min": { type: "string", default: "60" },
        "poll-ms": { type: "string", default: "5000" },
        "timeout-min": { type: "string" },
        touch: { type: "string" },
        status: { type: "string", default: "DONE" },
        reason: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    fail(2, `${e.message}\n\n${USAGE}`);
  }
  if (o.help) return console.log(USAGE);
  if (!["resume", "status"].includes(cmd) && !id) fail(2, USAGE);
  for (const k of ["stale-min", "poll-ms", "timeout-min"]) if (o[k] !== undefined && !(Number(o[k]) > 0)) fail(2, `--${k} must be a positive number`);
  if (!["DONE", "FAILED"].includes(o.status)) fail(2, "--status must be DONE or FAILED");

  const g = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: o.repo, encoding: "utf8" });
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo}`);
  const dir = path.join(path.dirname(g.stdout.trim()), ".worktrees", ".andx-run", "ship");
  fs.mkdirSync(dir, { recursive: true });

  const now = () => new Date().toISOString();
  const stale = (x) => age(x.heartbeat) > Number(o["stale-min"]);
  const LOCK = path.join(dir, "lock.json"), HALT = path.join(dir, "halted.json");
  const ticketPath = (t) => path.join(dir, `ticket-${t.replace(/[^\w.-]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}.json`);
  const write = (p, x) => fs.writeFileSync(p, JSON.stringify(x));
  const log = (event, extra = {}) => fs.appendFileSync(path.join(dir, "log.jsonl"), `${JSON.stringify({ at: now(), event, ...extra })}\n`);
  // Sorted live tickets, or null when one is mid-write (granting then could skip an older ticket).
  const tickets = () => {
    const all = fs.readdirSync(dir).filter((f) => f.startsWith("ticket-")).map((f) => read(path.join(dir, f)));
    if (all.includes(undefined)) return null;
    return all.filter(Boolean).sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id));
  };
  const holds = () => read(LOCK)?.id === id;
  const drop = (event, extra) => {
    rm(LOCK);
    rm(ticketPath(id));
    log(event, { id, ...extra });
  };

  if (cmd === "join") {
    const t = read(ticketPath(id)) ?? { id, joined_at: now(), touch: [] };
    if (!t.heartbeat) log("join", { id });
    t.heartbeat = now();
    if (o.touch !== undefined) t.touch = o.touch.split(",").filter(Boolean).map(norm);
    write(ticketPath(id), t);
    console.log(`JOINED ${id}`);
  } else if (cmd === "wait") {
    const me = read(ticketPath(id));
    if (!me) fail(2, `not joined: ${id}`);
    const deadline = o["timeout-min"] ? Date.now() + Number(o["timeout-min"]) * 60000 : Infinity;
    const halted = () => {
      const h = read(HALT);
      if (!h) return;
      console.log(`HALTED ${h.reason}`);
      process.exit(3);
    };
    const poll = () => {
      halted();
      me.heartbeat = now();
      write(ticketPath(id), me); // also restores the ticket if a peer reclaimed it after a long sleep
      const live = tickets();
      for (const t of live ?? []) {
        if (t.id === id || !stale(t)) continue;
        rm(ticketPath(t.id));
        log("stale-reclaim", { id: t.id, kind: "ticket" });
        console.log(`reclaimed stale ticket ${t.id}`);
      }
      if (live?.find((t) => t.id === id || !stale(t))?.id === id) {
        const l = read(LOCK);
        // Only the head ticket reclaims a stale lock so waiters do not race on it.
        // Limit: two processes that both think they are head can still double-unlink; a lock generation counter would close that.
        if (l && stale(l)) {
          rm(LOCK);
          log("stale-reclaim", { id: l.id, kind: "lock" });
          console.log(`reclaimed stale lock ${l.id}`);
        }
        try {
          fs.writeFileSync(LOCK, JSON.stringify({ id, acquired_at: now(), heartbeat: now() }), { flag: "wx" });
          if (read(HALT)) rm(LOCK); // halt writes halted.json before freeing the lock, so this catches a halt mid-poll
          halted();
          log("grant", { id });
          console.log(`GRANTED ${id}`);
          process.exit(0);
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
        }
      }
      if (Date.now() > deadline) {
        console.log("TIMEOUT");
        process.exit(4);
      }
      setTimeout(poll, Number(o["poll-ms"]));
    };
    poll();
  } else if (cmd === "heartbeat") {
    const t = read(ticketPath(id)), l = read(LOCK), holder = l?.id === id;
    if (holder) write(LOCK, { ...l, heartbeat: now() });
    else if (!t) fail(2, `not joined: ${id}`);
    if (t) write(ticketPath(id), { ...t, heartbeat: now() });
    console.log(`${holder ? "HOLDER" : "WAITER"} ${id}`);
  } else if (cmd === "release") {
    if (!holds()) fail(5, `not holder: ${id}`);
    drop("release", { status: o.status });
    console.log(`RELEASED ${id} ${o.status}`);
  } else if (cmd === "halt") {
    if (!o.reason) fail(2, "halt needs --reason");
    if (!holds()) fail(5, `not holder: ${id}`);
    write(HALT, { id, reason: o.reason, at: now() });
    drop("halt", { reason: o.reason });
    console.log(`HALTED ${o.reason}`);
  } else if (cmd === "resume") {
    rm(HALT);
    log("resume");
    console.log("RESUMED");
  } else if (cmd === "status") {
    const h = read(HALT), l = read(LOCK), live = (tickets() ?? []).filter((t) => !stale(t));
    const m = (iso) => `${Math.round(age(iso))}m`;
    console.log(h ? `halted: ${h.reason} (by ${h.id})` : "halted: no");
    console.log(l ? `holder: ${l.id} held ${m(l.acquired_at)}${stale(l) ? " STALE" : ""}` : "holder: none");
    live.filter((t) => t.id !== l?.id).forEach((t, i) => console.log(`waiter ${i + 1}: ${t.id} waiting ${m(t.joined_at)}`));
    if (o.touch) {
      const mine = o.touch.split(",").filter(Boolean).map(norm);
      for (const t of live) if (overlaps(mine, t.touch)) console.log(`overlap: ${t.id} ${t.touch.join(",")}`);
    }
  } else fail(2, USAGE);
}

if (import.meta.main) main(process.argv.slice(2));
