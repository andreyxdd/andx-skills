#!/usr/bin/env node
// Run ledger: one JSON file per run that the Stop hook reads and that gates DONE on the recorded phases.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

export const TERMINAL = ["DONE", "ABORTED", "ESCALATED", "AWAITING_USER"];
// Phase ids are the letters each composer skill uses for its workflow.
export const REQUIRED = {
  execute: ["A", "F"],
  review: ["A", "C", "D", "F"],
  "review-mr": ["A", "C", "D", "MR"],
  deploy: ["A", "A′", "B", "C", "D"],
  "review-deploy": ["A", "A′", "B", "C", "D"],
  debug: ["A", "B", "C", "D"],
};
// A non-terminal ledger untouched this long belongs to a crashed run: hooks stop acting on it.
export const STALE_MS = 24 * 3600 * 1000;
const STATUS = ["NOT_REQUESTED", "PASS", "FAIL", "BLOCKED", "-"];
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const ledgerDir = (root) => path.join(root, ".worktrees", ".andx-run");

// Ledger files of one primary checkout; dotfiles are half-written temp files.
export function ledgers(root) {
  const dir = ledgerDir(root);
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// Local time, YYYYMMDD-HHMMSS.
export function newStamp(now = new Date()) {
  return new Date(now - now.getTimezoneOffset() * 60000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

// The one naming rule for run branches and worktrees: exec-<slug>[-w<wave>[-<step>]]-<stamp>.
export function runNames({ root, slug, wave, step, stamp }) {
  const name = ["exec", slug, wave && `w${wave}`, step, stamp].filter(Boolean).join("-");
  return { EXEC_BRANCH: `andx/${name}`, WORKTREE_DIR: path.join(root, ".worktrees", name) };
}

const USAGE = `run: one ledger per run at <primary checkout>/.worktrees/.andx-run/<slug>.json

  start --slug S --mode M    write a fresh ledger and print REPO_ROOT, TARGET_BRANCH, STAMP,
                             EXEC_BRANCH, WORKTREE_DIR, SHIP_ID as KEY=value lines
  phase <slug> <id>          set the current phase and add it to the recorded phases
  landed <slug> <sha>        record the commit that landed on TARGET_BRANCH
  end <slug> --terminal T [--merged S] [--pushed S] [--mr URL] [--deployed S]
                             T: ${TERMINAL.join("|")}; S: ${STATUS.join("|")} (default NOT_REQUESTED, --mr default -)
                             DONE needs every required phase of the mode; prints the final status line
  show <slug>                print the ledger

Required phases: ${Object.entries(REQUIRED).map(([m, p]) => `${m} [${p.join(",")}]`).join(", ")}
Common: --repo DIR (default cwd; any worktree of the repo). Slug: [a-z0-9-], max 40.
Exit: 0 ok, 2 usage or no ledger, 5 DONE refused.`;

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

export function readLedger(p) {
  try {
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

// The tmp name starts with "." so ledger scans that skip dotfiles never see a half-written file.
export function writeLedger(p, data) {
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(tmp, p);
    } catch (e) {
      // Windows refuses the rename while another process has the target open.
      if (i >= 10 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function main(args) {
  let o, cmd, slug, arg;
  try {
    ({ values: o, positionals: [cmd, slug, arg] } = parseArgs({
      args,
      allowPositionals: true,
      options: Object.fromEntries([
        ...["repo", "slug", "mode", "terminal", "merged", "pushed", "mr", "deployed"].map((k) => [k, { type: "string" }]),
        ["help", { type: "boolean", short: "h" }],
      ]),
    }));
  } catch (e) {
    fail(2, `${e.message}\n\n${USAGE}`);
  }
  if (o.help) return console.log(USAGE);
  if (cmd === "start") slug = o.slug;
  if (!SLUG.test(slug ?? "")) fail(2, `bad or missing slug: ${slug ?? ""}\n\n${USAGE}`);

  const g = git(o.repo ?? ".", "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo ?? "."}`);
  const root = path.resolve(path.dirname(g.stdout.trim()));
  const file = path.join(ledgerDir(root), `${slug}.json`);

  if (cmd === "start") {
    if (!Object.hasOwn(REQUIRED, o.mode ?? "")) fail(2, `bad mode: ${o.mode ?? ""} (${Object.keys(REQUIRED).join("|")})`);
    const target = git(root, "branch", "--show-current").stdout?.trim();
    if (!target) fail(2, `primary checkout ${root} is not on a branch`);
    const stamp = newStamp();
    const { EXEC_BRANCH: branch, WORKTREE_DIR } = runNames({ root, slug, stamp });
    const vars = { REPO_ROOT: root, TARGET_BRANCH: target, STAMP: stamp, EXEC_BRANCH: branch, WORKTREE_DIR, SHIP_ID: branch };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeLedger(file, {
      slug, mode: o.mode, ship_id: branch, phase: null, phases: [], required_phases: REQUIRED[o.mode],
      continues: 0, terminal: null, landed: null, vars,
    });
    for (const [k, v] of Object.entries(vars)) console.log(`${k}=${v}`);
    return;
  }

  const data = readLedger(file);
  if (!data) fail(2, `no ledger: ${file}`);
  if (cmd === "phase") {
    if (!arg) fail(2, "phase needs <id>");
    data.phase = arg;
    data.phases = [...new Set([...(data.phases ?? []), arg])];
    writeLedger(file, data);
    console.log(`PHASE ${slug} ${arg}`);
  } else if (cmd === "landed") {
    if (!/^[0-9a-f]{7,64}$/i.test(arg ?? "")) fail(2, `landed needs a commit sha, got: ${arg ?? ""}`);
    data.landed = arg;
    writeLedger(file, data);
    console.log(`LANDED ${slug} ${arg}`);
  } else if (cmd === "end") {
    if (!TERMINAL.includes(o.terminal)) fail(2, `--terminal must be one of ${TERMINAL.join("|")}`);
    const s = { merged: o.merged ?? "NOT_REQUESTED", pushed: o.pushed ?? "NOT_REQUESTED", mr: o.mr || "-", deployed: o.deployed ?? "NOT_REQUESTED" };
    for (const k of ["merged", "pushed", "deployed"]) if (!STATUS.includes(s[k])) fail(2, `--${k} must be one of ${STATUS.join("|")}`);
    if (o.terminal === "DONE") {
      const req = Array.isArray(data.required_phases) ? data.required_phases : Object.hasOwn(REQUIRED, data.mode ?? "") ? REQUIRED[data.mode] : null;
      if (!req) fail(5, `DONE refused for ${slug}: no required phases for mode ${data.mode ?? ""}`);
      const missing = req.filter((p) => !(data.phases ?? []).includes(p));
      if (missing.length) fail(5, `DONE refused for ${slug}: missing required phases: ${missing.join(", ")}`);
    }
    data.terminal = o.terminal;
    data.status = s;
    writeLedger(file, data);
    console.log(`MERGED ${s.merged} | PUSHED ${s.pushed} | MR ${s.mr} | DEPLOYED ${s.deployed}`);
  } else if (cmd === "show") {
    console.log(JSON.stringify(data, null, 2));
  } else fail(2, USAGE);
}

if (import.meta.main) main(process.argv.slice(2));
