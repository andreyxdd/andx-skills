#!/usr/bin/env node
// Idempotent install/uninstall of andx hooks.
//   Claude ~/.claude/settings.json  Stop -> hooks/andx-continue.mjs (Cursor runs it too)
//   Cursor ~/.cursor/hooks.json     preToolUse + beforeMCPExecution -> hooks/deny-worktree-root.mjs
// Preserves unknown keys and other hooks; backs up before write; atomic rename; no write when unchanged.
// Usage: node install-hooks.mjs install|uninstall [--home DIR]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTINUE = `node "${path.join(ROOT, "hooks", "andx-continue.mjs")}"`;
const GUARD = `node "${path.join(ROOT, "hooks", "deny-worktree-root.mjs")}"`;
// Legacy entries: any command under .../andx-skills/hooks/ (older hook scripts), either separator style.
const ours = (cmd) => cmd === CONTINUE || cmd === GUARD || /andx-skills[\\/]hooks[\\/]/.test(String(cmd ?? ""));

const load = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback);

function save(p, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === text) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak-${stamp}`);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

function claude(p, install) {
  const data = load(p, {});
  data.hooks ??= {};
  const stop = (data.hooks.Stop ?? []).filter((g) => ![g.hooks ?? []].flat().some((h) => ours(h?.command)));
  if (install) stop.push({ hooks: [{ type: "command", command: CONTINUE, timeout: 10 }] });
  data.hooks.Stop = stop;
  save(p, data);
}

function cursor(p, install) {
  const data = load(p, { version: 1, hooks: {} });
  data.hooks ??= {};
  for (const ev of ["preToolUse", "beforeMCPExecution"]) {
    const list = (data.hooks[ev] ?? []).filter((h) => !ours(h?.command));
    if (install) list.push({ command: GUARD, timeout: 5 });
    if (list.length) data.hooks[ev] = list;
    else delete data.hooks[ev];
  }
  save(p, data);
}

const [mode, ...rest] = process.argv.slice(2);
if (!["install", "uninstall"].includes(mode)) {
  console.error("usage: install-hooks.mjs install|uninstall [--home DIR]");
  process.exit(1);
}
const i = rest.indexOf("--home");
const home = i >= 0 && rest[i + 1] ? path.resolve(rest[i + 1]) : os.homedir();
claude(path.join(home, ".claude", "settings.json"), mode === "install");
cursor(path.join(home, ".cursor", "hooks.json"), mode === "install");
console.log(`andx hooks ${mode}ed (${home})`);
