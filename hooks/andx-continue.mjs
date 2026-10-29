#!/usr/bin/env node
// Stop hook (Claude format; Cursor maps decision=block to followup_message).
// Blocks the agent from ending its turn while an andx run ledger written in
// this conversation is non-terminal. Fail-open on any error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TERMINAL = ["DONE", "ABORTED", "ESCALATED", "AWAITING_USER"];
const MAX_CONTINUES = 5;
const STALE_MS = 24 * 3600 * 1000;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function subdirs(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name));
  } catch {
    return [];
  }
}

// <root>/.worktrees/.andx-run/*.json and the same up to three directory levels below root.
function ledgerPaths(dirs) {
  const found = new Set();
  for (const dir of dirs) {
    if (typeof dir !== "string" || !isDir(dir)) continue;
    const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim();
    for (const root of new Set([dir, top].filter(Boolean).map((r) => path.resolve(r)))) {
      let level = [root];
      for (let depth = 0; depth <= 3; depth++) {
        for (const d of level) {
          const run = path.join(d, ".worktrees", ".andx-run");
          if (!isDir(run)) continue;
          for (const f of fs.readdirSync(run)) if (f.endsWith(".json") && !f.startsWith(".")) found.add(path.join(run, f));
        }
        if (depth < 3) level = level.flatMap(subdirs);
      }
    }
  }
  return [...found];
}

function decide(input, now = Date.now()) {
  const transcript = String(input.transcript_path ?? "");
  if (!transcript || !fs.statSync(transcript, { throwIfNoEntry: false })?.isFile()) return null;
  const log = fs.readFileSync(transcript, "utf8");
  const dirs = [input.cwd, ...[input.workspace_roots ?? []].flat()].filter((d) => d != null);
  for (const p of ledgerPaths(dirs)) {
    let data;
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const continues = Number.parseInt(data.continues ?? 0, 10) || 0;
    if (TERMINAL.includes(String(data.terminal ?? ""))) continue;
    if (continues >= MAX_CONTINUES) continue;
    if (now - fs.statSync(p).mtimeMs > STALE_MS) continue;
    const base = path.basename(p);
    if (!log.includes(`.andx-run/${base}`) && !log.includes(`.andx-run\\${base}`)) continue;
    data.continues = continues + 1;
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return {
      decision: "block",
      reason: `andx run '${data.slug ?? ""}' (mode ${data.mode ?? ""}) is at phase ${data.phase ?? ""}, not terminal. ` +
        `Continue to the Definition of done. If blocked on the user, set "terminal": "AWAITING_USER" ` +
        `(or ESCALATED/ABORTED) in ${p} and say why. Continue ${data.continues}/${MAX_CONTINUES}.`,
    };
  }
  return null;
}

try {
  const out = decide(JSON.parse(fs.readFileSync(0, "utf8")));
  if (out) console.log(JSON.stringify(out));
} catch {
  // fail-open
}
process.exit(0);
