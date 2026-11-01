#!/usr/bin/env node
// Symlink canonical andx skills into Cursor, Claude, and Codex skill directories.
// Usage: node install.mjs [--uninstall-hooks] [--home DIR]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = [
  "andx-init",
  "andx-plan",
  "andx-schedule",
  "andx-execute",
  "andx-orchestration",
  "andx-debug-and-fix",
  "andx-deploy",
  "andx-deploy-init",
  "andx-execute-and-deploy",
  "andx-execute-and-review",
  "andx-execute-review-and-deploy",
  "andx-mr-review",
  "andx-mr-babysit",
  "andx-mr-create",
  "andx-security-review",
  "andx-listen-start",
  "andx-listen-end",
];
const RETIRED = ["andx-pr-review"];
// Agents that run a mid-tier model instead of inheriting the parent's: home dir -> model id for that harness.
const MODELS = { "andx-spec-reviewer.md": { ".claude": "sonnet", ".cursor": "claude-sonnet-5-5" } };

// Replace `dest` with a link to `target`. Windows: directory junctions (no admin); a file symlink
// may need Developer Mode, so fall back to a copy. Returns "linked" or "copied".
export function link(target, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (process.platform !== "win32") fs.symlinkSync(target, dest);
  else if (fs.statSync(target).isDirectory()) fs.symlinkSync(target, dest, "junction");
  else {
    try {
      fs.symlinkSync(target, dest, "file");
    } catch (e) {
      if (e.code !== "EPERM") throw e;
      fs.copyFileSync(target, dest);
      return "copied";
    }
  }
  return "linked";
}

function main(args) {
  const i = args.indexOf("--home");
  const home = i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : os.homedir();
  const script = (name, ...a) => spawnSync(process.execPath, [path.join(ROOT, "scripts", name), ...a], { stdio: "inherit" }).status;

  if (args.includes("--uninstall-hooks")) return script("install-hooks.mjs", "uninstall", "--home", home) ?? 1;
  if (script("check-skills.mjs", ROOT) !== 0) {
    console.error("check-skills failed; nothing linked");
    return 1;
  }

  for (const h of [".cursor", ".claude", ".codex"]) {
    const target = path.join(home, h, "skills");
    fs.mkdirSync(target, { recursive: true });
    for (const skill of SKILLS) {
      const src = path.join(ROOT, skill);
      if (!fs.existsSync(src)) {
        console.error(`missing canonical skill: ${src}`);
        return 1;
      }
      link(src, path.join(target, skill));
      console.log(`linked ${path.join(target, skill)} -> ${src}`);
    }
    for (const skill of RETIRED) fs.rmSync(path.join(target, skill), { recursive: true, force: true });
  }

  // Agents link into ~/.claude/agents, which Cursor reads too. MODELS agents are written as copies with a
  // per-harness model instead; Cursor prefers the ~/.cursor/agents copy over the same-name Claude one.
  const agents = path.join(home, ".claude", "agents");
  fs.mkdirSync(agents, { recursive: true });
  for (const name of fs.readdirSync(path.join(ROOT, "agents")).filter((f) => f.endsWith(".md")).sort()) {
    const src = path.join(ROOT, "agents", name);
    if (!MODELS[name]) {
      const how = link(src, path.join(agents, name));
      console.log(`${how} ${path.join(agents, name)}${how === "copied" ? " (symlink not permitted; re-run after edits)" : ""}`);
      continue;
    }
    for (const [h, model] of Object.entries(MODELS[name])) {
      const dest = path.join(home, h, "agents", name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { force: true }); // an old symlink would route the write into the repo source
      fs.writeFileSync(dest, fs.readFileSync(src, "utf8").replace(/^model: inherit$/m, `model: ${model}`));
      console.log(`wrote ${dest} (model: ${model}; re-run after edits)`);
    }
  }

  const status = script("install-hooks.mjs", "install", "--home", home);
  if (status !== 0) return status ?? 1;
  console.log(`Done. Canonical source: ${ROOT}`);
  console.log("Run node install-companions.mjs for optional companions (e.g. react-best-practices).");
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
