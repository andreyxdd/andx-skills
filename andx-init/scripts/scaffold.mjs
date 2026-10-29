#!/usr/bin/env node
// Scaffold OKF + ICM hybrid layout into a target repo (additive, no overwrite).
//   node scaffold.mjs <preset> <repo_root>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: scaffold.mjs <preset> <repo_root>");
  console.error("  preset: app | data | content");
  process.exit(1);
}
const [preset, repo] = args;
const template = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", preset);
const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

if (!/^[\w-]+$/.test(preset) || !isDir(template)) {
  console.error(`Unknown preset: ${preset}`);
  process.exit(1);
}
if (!isDir(repo)) {
  console.error(`Repo root does not exist: ${repo}`);
  process.exit(1);
}

for (const rel of fs.readdirSync(template, { recursive: true }).sort()) {
  const src = path.join(template, rel), dest = path.join(repo, rel);
  if (!fs.statSync(src).isFile()) continue;
  if (fs.existsSync(dest)) {
    console.log(`skip (exists): ${dest}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`created: ${dest}`);
}

// Ensure output dirs exist (not always in template as files)
const pipeline = path.join(repo, "pipeline");
for (const stage of isDir(pipeline) ? fs.readdirSync(pipeline) : []) {
  if (stage[0] === "." || !isDir(path.join(pipeline, stage))) continue;
  const out = path.join(pipeline, stage, "output");
  fs.mkdirSync(out, { recursive: true });
  fs.appendFileSync(path.join(out, ".gitkeep"), "");
}

fs.mkdirSync(path.join(repo, ".cursor", "plans"), { recursive: true });

const gitignore = path.join(repo, ".gitignore");
const LINES = ["pipeline/*/output/*", "!pipeline/*/output/.gitkeep", ".cursor/plans/"];
if (fs.existsSync(gitignore)) {
  let text = fs.readFileSync(gitignore, "utf8");
  const have = new Set(text.split(/\r?\n/));
  for (const line of LINES.filter((l) => !have.has(l))) {
    text += `${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
    console.log(`appended .gitignore: ${line}`);
  }
  fs.writeFileSync(gitignore, text);
} else {
  fs.writeFileSync(gitignore, LINES.join("\n") + "\n");
  console.log("created .gitignore");
}

console.log(`Scaffold complete: preset=${preset} root=${repo}`);
