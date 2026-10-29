#!/usr/bin/env node
// Install optional companion skills (external; not symlinked from andx-skills).
//   react-best-practices: copied from vercel-labs/agent-skills
//   Matt Pocock skills: symlinked from a pinned clone at ~/Dev/tools/mattpocock-skills (override: MATT_DIR)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain, link } from "./install.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MATT_REPO = "https://github.com/mattpocock/skills.git";
const MATT_PIN = "f3fc563";
// Model-invoked (andx consumers) + user-invoked (upstream sets disable-model-invocation).
const MATT_SKILLS = [
  "productivity/grilling",
  "engineering/tdd",
  "engineering/codebase-design",
  "engineering/diagnosing-bugs",
  "engineering/wizard",
  "engineering/pr",
  "productivity/writing-for-agents",
  "productivity/grill-me",
  "productivity/handoff",
  "engineering/improve-codebase-architecture",
  "engineering/to-spec",
  "engineering/to-tickets",
  "engineering/retro",
];
const REACT_REPO = "https://github.com/vercel-labs/agent-skills.git";
const REACT = "react-best-practices";

// Cursor loads react-best-practices only when a .tsx/.jsx file is in play.
export function addReactPaths(file) {
  const text = fs.readFileSync(file, "utf8");
  const out = text.replace(/^---[ \t]*\n([\s\S]*?\n)?---[ \t]*(?=\n|$)/, (all, fm = "") =>
    (/^paths:/m.test(fm) ? all : `---\n${fm}paths: "**/*.tsx, **/*.jsx"\n---`));
  if (out !== text) fs.writeFileSync(file, out);
}

export function installTarget(target, reactSrc, mattDir, mattSkills = MATT_SKILLS) {
  fs.mkdirSync(target, { recursive: true });
  const dest = path.join(target, REACT);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(reactSrc, dest, { recursive: true });
  addReactPaths(path.join(dest, "SKILL.md"));
  console.log(`installed ${dest}`);
  for (const p of mattSkills) {
    const name = path.join(target, path.basename(p));
    const st = fs.lstatSync(name, { throwIfNoEntry: false });
    if (st && !st.isSymbolicLink()) {
      console.error(`skip ${name}: real directory (archive it first)`);
      continue;
    }
    const src = path.join(mattDir, "skills", ...p.split("/"));
    link(src, name);
    console.log(`linked ${name} -> ${src}`);
  }
}

function git(args, { check = true } = {}) {
  const r = spawnSync("git", args, { stdio: "inherit" });
  if (check && r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

function main() {
  const home = os.homedir();
  const mattDir = process.env.MATT_DIR || path.join(home, "Dev", "tools", "mattpocock-skills");
  if (!fs.existsSync(path.join(mattDir, ".git"))) git(["clone", "-q", MATT_REPO, mattDir]);
  git(["-C", mattDir, "fetch", "-q", "origin"], { check: false });
  git(["-C", mattDir, "checkout", "-q", MATT_PIN]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "andx-companions-"));
  try {
    const repo = path.join(tmp, "repo");
    git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", REACT_REPO, repo]);
    git(["-C", repo, "sparse-checkout", "set", `skills/${REACT}`]);
    for (const h of [".cursor", ".claude"]) installTarget(path.join(home, h, "skills"), path.join(repo, "skills", REACT), mattDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Catalog cost per harness; a non-empty duplicates= list means a skill dir copy shadows an enabled plugin.
  spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-skills.mjs"), "--budget"], { stdio: "inherit" });
  console.log(`Done. Matt Pocock skills pinned at ${MATT_PIN}.`);
}

if (isMain(import.meta.url)) main();
