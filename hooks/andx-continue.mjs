#!/usr/bin/env node
// Stop hook (Claude/Codex format; Cursor maps decision=block to followup_message; Kimi uses --exit2).
// Blocks the agent from ending its turn while an andx run ledger written in
// this conversation is non-terminal. Fail-open on any error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MAX_CONTINUES = 5;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function subdirs(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(d, e.name));
  } catch {
    return [];
  }
}

// <root>/.worktrees/.andx-run/*.json and the same up to three directory levels below root.
function ledgerPaths(ledgers, dirs) {
  const found = new Set();
  for (const dir of dirs) {
    if (typeof dir !== "string" || !isDir(dir)) continue;
    const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim();
    for (const root of new Set([dir, top].filter(Boolean).map((r) => path.resolve(r)))) {
      let level = [root];
      for (let depth = 0; depth <= 3; depth++) {
        for (const d of level) for (const p of ledgers(d)) found.add(p);
        if (depth < 3) level = level.flatMap(subdirs);
      }
    }
  }
  return [...found];
}

function decide({ TERMINAL, STALE_MS, ledgers, readLedger, writeLedger }, input) {
  const transcript = String(input.transcript_path ?? "");
  if (!transcript || !fs.statSync(transcript, { throwIfNoEntry: false })?.isFile()) return null;
  const log = fs.readFileSync(transcript, "utf8");
  const dirs = [input.cwd, ...[input.workspace_roots ?? []].flat()].filter((d) => d != null);
  for (const p of ledgerPaths(ledgers, dirs)) {
    const data = readLedger(p);
    if (!data) continue;
    const continues = Number.parseInt(data.continues ?? 0, 10) || 0;
    if (TERMINAL.includes(String(data.terminal ?? ""))) continue;
    if (continues >= MAX_CONTINUES) continue;
    if (Date.now() - fs.statSync(p).mtimeMs > STALE_MS) continue;
    const base = path.basename(p);
    if (!log.includes(`.andx-run/${base}`) && !log.includes(`.andx-run\\${base}`)) continue;
    data.continues = continues + 1;
    try {
      writeLedger(p, data);
    } catch (e) {
      console.error(`andx-continue: could not update ${p}: ${e.message}`);
      return null;
    }
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
  const run = await import("../andx-orchestration/scripts/run.mjs");
  const out = decide(run, JSON.parse(fs.readFileSync(0, "utf8")));
  // --exit2: harnesses (Kimi) that continue on exit 2 with the reason on stderr instead of JSON.
  if (out && process.argv.includes("--exit2")) {
    console.error(out.reason);
    process.exit(2);
  }
  if (out) console.log(JSON.stringify(out));
} catch {
  // fail-open
}
process.exit(0);
