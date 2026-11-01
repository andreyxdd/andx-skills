#!/usr/bin/env node
// Serialize the ship phase of parallel runs on one repo: one lock holder at a time, granted in join order.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readLedger } from "./run.mjs";

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.mjs");
const NS = "refs/andx/ship";
const LOCK = `${NS}/lock`, HALT = `${NS}/halted`;
const GIT_MIN = "2.38+ (for-each-ref %(raw) since 2.36, merge-tree --write-tree since 2.38)";

const USAGE = `ship-queue: one run lands and deploys at a time; others wait in join order.

  announce <id> --touch p1,p2    record planned paths before executing (overlap warnings only, not a ticket)
  join <id> [--touch p1,p2]      add a ticket when ready to land (idempotent: re-join keeps the original place).
                                 First checks git merge-tree TARGET EXEC: on conflict prints CONFLICT f1,f2 and
                                 exits 6 without queueing. EXEC is the --worktree branch, else branch <id> if it exists
  wait <id> [--poll-ms 5000]     block until this ticket is the oldest live one and the lock is free; prints
                                 GRANTED <id> gen <n> (exit 0) or HALTED <reason> (exit 3, ticket kept).
                                 SIGINT, SIGTERM and SIGHUP drop the ticket before exiting
  leave <id>                     drop this run's ticket
  heartbeat <id>                 holder only: refresh the lock; run before and after every long blocking wait
  land <id> --test CMD --worktree DIR
                                 holder only, lock kept on every outcome. Before touching anything it checks that DIR
                                 is a linked worktree (the ledger's WORKTREE_DIR when there is one; else exit 2) and
                                 that TARGET can land as below (else exit 9). Then: merge TARGET into DIR's branch (conflict:
                                 abort, CONFLICT f1,f2, exit 6); if that changed HEAD, run the shell command CMD in DIR
                                 (non-zero: exit 8); then land without switching branches: primary checkout on TARGET
                                 -> merge --ff-only; primary detached and TARGET checked out nowhere -> update-ref
                                 refs/heads/TARGET; otherwise exit 9. Prints LANDED <id> <sha>, then records the sha
                                 with run.mjs landed in the run ledger whose ship_id is <id>
  release <id> [--after-deploy]  holder only: free the lock, drop ticket and announcement; the next ticket gets the lock.
                                 After land, plain release exits 7: release --after-deploy once deploy health passes
                                 (or there is no deploy), or halt. --after-deploy before land exits 2
  halt <id> --reason TEXT        holder only: release and stop the queue; waiters exit 3
  resume                         clear a halt
  status [<id>] [--touch p1,p2]  holder, waiters with ages, halt state; with --touch, announced runs and
                                 tickets (other than <id>) whose paths overlap by path prefix

Common: --repo DIR (default cwd) --stale-min N (default 120, fractions allowed, must exceed 3x --poll-ms)
  --target BRANCH (join, land; default: TARGET_BRANCH of the run ledger whose ship_id is <id>)
  --gen N (heartbeat, land, release, halt: exit 5 unless the lock is still at generation N)
A lock without a heartbeat for --stale-min is taken over by the head waiter at the next generation. A waiter
ticket without a heartbeat for max(10x its poll, 2 min), capped at --stale-min, is dropped. After HALTED,
rerunning join + wait keeps the run's place unless its ticket went stale.
State: git refs ${NS}/{lock,halted,ticket/<id>,announce/<id>}, shared by every worktree, each pointing at
a JSON blob; every write is a compare-and-swap through git update-ref. In ref names <id> is the hex of its
UTF-8 bytes, which keeps any id a valid ref name and distinct on case-insensitive filesystems.
Needs git ${GIT_MIN}.
Exit: 0 ok, 1 git error, 2 usage or not joined, 3 halted, 5 not holder or stale generation, 6 conflict,
7 release after land, 8 test failed, 9 cannot land without a branch switch.`;

const stamp = () => new Date().toISOString();
const age = (iso) => (Date.now() - Date.parse(iso)) / 60000;
const paths = (s = "") => s.split(",").filter(Boolean).map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""));
const overlaps = (a, b) => a.some((x) => b.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
const hex = (id) => Buffer.from(id).toString("hex");
const out = (r) => (r.stdout ?? "").trim();
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

// cas() returns the new blob oid, or null when the ref no longer holds `old` ("" means the ref must not exist).
export function refs(repo) {
  const git = (args, input) => spawnSync("git", args, { cwd: repo, encoding: "utf8", input });
  const snapshot = () => {
    const r = git(["for-each-ref", "--format=%(refname) %(objectname) %(raw)", `${NS}/`]);
    if (r.status !== 0) fail(1, `${r.stderr}ship-queue needs git ${GIT_MIN}`);
    const s = { lock: null, halted: null, ticket: [], announce: [] };
    for (const line of r.stdout.split("\n").filter(Boolean)) {
      const [ref, oid] = line.split(" ", 2);
      let data = null;
      try {
        data = JSON.parse(line.slice(ref.length + oid.length + 2));
      } catch {}
      const kind = ref.slice(NS.length + 1).split("/")[0];
      if (Array.isArray(s[kind])) s[kind].push({ ref, oid, data });
      else s[kind] = { ref, oid, data };
    }
    return s;
  };
  const cas = (ref, data, old) => {
    const h = git(["hash-object", "-w", "--stdin"], JSON.stringify(data));
    if (h.status !== 0) fail(1, h.stderr);
    const oid = h.stdout.trim();
    return git(["update-ref", ref, oid, old]).status === 0 ? oid : null;
  };
  const del = (ref, old) => git(["update-ref", "-d", ref, old]).status === 0;
  return { snapshot, cas, del };
}

// Swapping from the exact lock blob in snapshot `s` is the fence: of two processes that read the same lock,
// only one gets the next generation. Returns { gen, oid } or null.
export function takeLock({ cas }, s, id) {
  const gen = (s.lock?.data?.gen ?? 0) + 1;
  const oid = cas(LOCK, { gen, holder: id, acquired_at: stamp(), heartbeat: stamp(), landed: null }, s.lock?.oid ?? "");
  return oid && { gen, oid };
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
        ...Object.fromEntries(["touch", "reason", "target", "worktree", "test", "gen"].map((k) => [k, { type: "string" }])),
        "after-deploy": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    fail(2, `${e.message}\n\n${USAGE}`);
  }
  if (o.help) return console.log(USAGE);
  if (!["resume", "status"].includes(cmd) && !id) fail(2, USAGE);
  if (id && hex(id).length > 200) fail(2, `id too long for a ref name: ${id}`);
  const staleMin = Number(o["stale-min"]), pollMs = Number(o["poll-ms"]);
  if (!(pollMs > 0) || !(staleMin * 60000 > 3 * pollMs)) fail(2, "--poll-ms must be positive and --stale-min must exceed 3x --poll-ms");
  if (o.gen !== undefined && !/^\d+$/.test(o.gen)) fail(2, "--gen must be a generation number");
  if (cmd === "announce" && !o.touch) fail(2, "announce needs --touch");
  if (cmd === "halt" && !o.reason) fail(2, "halt needs --reason");
  if (cmd === "land" && !(o.test && o.worktree)) fail(2, "land needs --test CMD and --worktree DIR");

  const g = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: o.repo, encoding: "utf8" });
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo}`);
  const root = path.dirname(g.stdout.trim());
  const { snapshot, cas, del } = refs(root);
  const at = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
  const rev = (cwd, r) => out(at(cwd, "rev-parse", "-q", "--verify", r));

  const ticketRef = (t) => `${NS}/ticket/${hex(t)}`, announceRef = (t) => `${NS}/announce/${hex(t)}`;
  const lockStale = (l) => age(l.heartbeat) > staleMin;
  const ticketStale = (t) => age(t.heartbeat) > Math.min(staleMin, Math.max((10 * (t.poll_ms ?? 5000)) / 60000, 2));
  const byJoin = (a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id);
  const get = (ref) => {
    const s = snapshot();
    return [s.lock, s.halted, ...s.ticket, ...s.announce].find((e) => e?.ref === ref) ?? null;
  };
  // Read-modify-write, retried while another process wins the swap.
  const update = (ref, fn) => {
    for (let i = 0; i < 20; i++) {
      const cur = get(ref);
      const next = fn(cur?.data ?? null);
      if (cas(ref, next, cur?.oid ?? "")) return next;
    }
    fail(1, `${ref} kept changing; retry`);
  };
  const drop = (ref) => {
    for (let i = 0, cur; i < 20 && (cur = get(ref)); i++) if (del(ref, cur.oid)) return;
  };
  const holder = (l) => {
    if (l?.holder !== id) fail(5, `not holder: ${id}`);
    if (o.gen !== undefined && Number(o.gen) !== l.gen) fail(5, `stale generation: ${id} was granted gen ${o.gen}, the lock is at gen ${l.gen}`);
    return l;
  };
  const setLock = (fn) => update(LOCK, (l) => fn(holder(l)));
  const free = (l) => ({ gen: l.gen, holder: null, released_at: stamp() });
  const dropOwn = () => (drop(ticketRef(id)), drop(announceRef(id)));
  const landedMsg = (l) => `LANDED, use halt or release --after-deploy (landed ${l.landed})`;
  const ledger = () => {
    const dir = path.join(root, ".worktrees", ".andx-run");
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    return names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).map((n) => readLedger(path.join(dir, n))).find((d) => d?.ship_id === id);
  };

  if (cmd === "announce") {
    update(announceRef(id), () => ({ id, at: stamp(), touch: paths(o.touch) }));
    console.log(`ANNOUNCED ${id}`);
  } else if (cmd === "join") {
    const target = o.target ?? ledger()?.vars?.TARGET_BRANCH;
    const exec = o.worktree ? out(at(o.worktree, "branch", "--show-current")) : rev(root, `refs/heads/${id}`) && id;
    if (target && exec) {
      const m = at(root, "merge-tree", "--write-tree", "--name-only", `refs/heads/${target}`, `refs/heads/${exec}`);
      if (m.status === 1) {
        // Output: tree oid, conflicted names, a blank line, then messages.
        const lines = m.stdout.split("\n"), end = lines.indexOf("", 1);
        console.log(`CONFLICT ${lines.slice(1, end < 0 ? undefined : end).join(",")}`);
        process.exit(6);
      }
      if (m.status !== 0) fail(2, `${m.stderr}ship-queue needs git ${GIT_MIN}`);
    }
    update(ticketRef(id), (t) => ({
      id, joined_at: t?.joined_at ?? stamp(), heartbeat: stamp(), poll_ms: pollMs,
      touch: o.touch !== undefined ? paths(o.touch) : t?.touch ?? [],
    }));
    console.log(`JOINED ${id}`);
  } else if (cmd === "wait") {
    let me = get(ticketRef(id))?.data;
    if (!me) fail(2, `not joined: ${id}`);
    for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]]) {
      process.on(sig, () => {
        drop(ticketRef(id));
        process.exit(128 + n);
      });
    }
    const halted = (h) => {
      if (!h) return;
      console.log(`HALTED ${h.data?.reason}`);
      process.exit(3);
    };
    const poll = () => {
      const s = snapshot();
      if (s.halted && s.lock?.data?.holder === id) update(LOCK, (l) => (l?.holder === id ? free(l) : l));
      halted(s.halted);
      const own = s.ticket.find((t) => t.ref === ticketRef(id));
      me = { ...(own?.data ?? me), heartbeat: stamp(), poll_ms: pollMs };
      // Also restores the ticket if a peer dropped it after a long sleep; a lost swap means a twin wait refreshed it.
      cas(ticketRef(id), me, own?.oid ?? "");
      const queue = [me];
      for (const t of s.ticket) {
        if (t === own) continue;
        if (t.data && !ticketStale(t.data)) queue.push(t.data);
        else if (del(t.ref, t.oid)) console.log(`reclaimed stale ticket ${t.data?.id ?? t.ref}`);
      }
      const l = s.lock?.data;
      if (queue.sort(byJoin)[0] === me && !(l?.holder && !lockStale(l))) {
        const { gen, oid } = takeLock({ cas }, s, id) ?? {};
        if (oid) {
          if (l?.holder) console.log(`reclaimed stale lock ${l.holder}`);
          // halt writes the halt ref before freeing the lock, so this catches a halt between our read and our swap;
          // the next poll then frees the lock before exiting 3.
          if (!get(HALT)) {
            drop(ticketRef(id));
            console.log(`GRANTED ${id} gen ${gen}`);
            process.exit(0);
          }
        }
      }
      setTimeout(poll, pollMs);
    };
    poll();
  } else if (cmd === "leave") {
    drop(ticketRef(id));
    console.log(`LEFT ${id}`);
  } else if (cmd === "heartbeat") {
    const l = setLock((l) => ({ ...l, heartbeat: stamp() }));
    console.log(`HOLDER ${id} gen ${l.gen}`);
  } else if (cmd === "land") {
    const l = holder(get(LOCK)?.data);
    if (l.landed) fail(7, landedMsg(l));
    const led = ledger();
    const target = o.target ?? led?.vars?.TARGET_BRANCH;
    if (!target) fail(2, `land needs --target: no run ledger has ship_id ${id}`);
    const real = (p) => {
      try {
        return fs.realpathSync.native(p);
      } catch {
        return path.resolve(p);
      }
    };
    const wt = real(o.worktree);
    const [gitDir, commonDir] = out(at(wt, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir")).split("\n").map(real);
    if (!gitDir || gitDir === commonDir || real(path.dirname(commonDir)) !== real(root)) {
      fail(2, `--worktree ${wt} must be a linked worktree of ${root}, not the primary checkout`);
    }
    if (led?.vars?.WORKTREE_DIR && real(led.vars.WORKTREE_DIR) !== wt) fail(2, `--worktree ${wt} is not the ledger's WORKTREE_DIR ${led.vars.WORKTREE_DIR}`);
    const exec = out(at(wt, "branch", "--show-current"));
    if (!exec) fail(2, `--worktree ${wt} is not on a branch`);
    const old = rev(root, `refs/heads/${target}`);
    if (!old) fail(2, `no branch ${target}`);
    // Checked before the integrate so a run that cannot land leaves its worktree untouched, and again before the write.
    const landMode = () => {
      const primary = out(at(root, "branch", "--show-current"));
      if (primary === target) return "ff";
      if (primary) fail(9, `primary checkout ${root} is on ${primary}, not ${target}: nothing landed, no branch switch`);
      const elsewhere = out(at(root, "worktree", "list", "--porcelain")).split("\n\n").find((b) => b.split("\n").includes(`branch refs/heads/${target}`));
      if (elsewhere) fail(9, `${target} checked out elsewhere: ${elsewhere.split("\n")[0].replace(/^worktree /, "")}`);
      return "ref";
    };
    const mode = landMode();
    const before = rev(wt, "HEAD");
    const m = at(wt, "merge", "--no-edit", target);
    if (m.status !== 0) {
      const files = out(at(wt, "diff", "--name-only", "--diff-filter=U")).split("\n").filter(Boolean);
      at(wt, "merge", "--abort");
      console.error(`${m.stdout}${m.stderr}`);
      console.log(`CONFLICT ${files.join(",")}`);
      process.exit(6);
    }
    const head = rev(wt, "HEAD");
    if (head !== before) {
      const t = spawnSync(o.test, { cwd: wt, shell: true, stdio: ["ignore", 2, 2] });
      if (t.status !== 0) fail(8, `TEST FAILED (exit ${t.status ?? t.signal}) after integrating ${target}: ${o.test}`);
    }
    setLock((cur) => {
      if (cur.gen !== l.gen) fail(5, `stale generation: ${id} started land at gen ${l.gen}, the lock is at gen ${cur.gen}`);
      return { ...cur, heartbeat: stamp() };
    });
    if (landMode() !== mode) fail(9, `primary checkout ${root} changed during land: nothing landed`);
    if (mode === "ff") {
      // The tested sha lands, not whatever the branch points at now; the reflog still names the branch.
      const f = spawnSync("git", ["merge", "--ff-only", head], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_REFLOG_ACTION: `merge ${exec}` } });
      if (f.status !== 0) fail(9, `merge --ff-only ${head} refused in ${root}: nothing landed\n${f.stderr}`);
    } else if (at(root, "merge-base", "--is-ancestor", old, head).status !== 0 || at(root, "update-ref", `refs/heads/${target}`, head, old).status !== 0) {
      fail(9, `${target} moved during land: nothing landed; run land again`);
    }
    const sha = rev(root, `refs/heads/${target}`);
    setLock((cur) => ({ ...cur, landed: sha, heartbeat: stamp() }));
    console.log(`LANDED ${id} ${sha}`);
    if (!led) return console.error(`no run ledger has ship_id ${id}: landing not recorded`);
    const r = spawnSync(process.execPath, [RUN, "landed", led.slug, sha, "--repo", root], { encoding: "utf8" });
    process.stdout.write(r.stdout);
    if (r.status !== 0) fail(1, r.stderr);
  } else if (cmd === "release") {
    setLock((l) => {
      if (l.landed && !o["after-deploy"]) fail(7, landedMsg(l));
      if (!l.landed && o["after-deploy"]) fail(2, "release --after-deploy needs a landed lock; use release");
      return free(l);
    });
    dropOwn();
    console.log(`RELEASED ${id}`);
  } else if (cmd === "halt") {
    holder(get(LOCK)?.data);
    update(HALT, () => ({ id, reason: o.reason, at: stamp() }));
    setLock(free);
    dropOwn();
    console.log(`HALTED ${o.reason}`);
  } else if (cmd === "resume") {
    drop(HALT);
    console.log("RESUMED");
  } else if (cmd === "status") {
    const s = snapshot(), h = s.halted?.data, l = s.lock?.data?.holder ? s.lock.data : null;
    const queue = s.ticket.map((t) => t.data).filter((t) => t && !ticketStale(t)).sort(byJoin);
    const m = (iso) => `${Math.round(age(iso))}m`;
    console.log(h ? `halted: ${h.reason} (by ${h.id})` : "halted: no");
    console.log(l ? `holder: ${l.holder} gen ${l.gen} held ${m(l.acquired_at)}${l.landed ? ` landed ${l.landed}` : ""}${lockStale(l) ? " STALE" : ""}` : "holder: none");
    queue.filter((t) => t.id !== l?.holder).forEach((t, i) => console.log(`waiter ${i + 1}: ${t.id} waiting ${m(t.joined_at)}`));
    if (o.touch) {
      // Announcements from runs that died before joining age out after a day.
      const inflight = s.announce.map((a) => a.data).filter((x) => x && age(x.at) < 1440);
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
