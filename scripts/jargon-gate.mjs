#!/usr/bin/env node
// Flags agent-tooling jargon that a first-time reviewer cannot read, in added diff lines
// (code, comments, shipped docs) and in commit / MR text. Exit 1 lists hits as path:line.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HELP = `usage:
  jargon-gate.mjs diff <base> <head> [--repo DIR] [--allow-skill-text]
      scans lines added in git diff <base>...<head> (merge-base to head, like a PR diff)
  jargon-gate.mjs text <file|->
      scans commit / MR text, e.g. git log --format='%s%n%b' main..HEAD | jargon-gate.mjs text -
  --allow-skill-text  skip *.md inside top-level folders that hold a SKILL.md (skill repos)
exit: 0 clean, 1 hits (path:line: text), 2 usage or git error`;

// One bracketed letter per alternative keeps this file from matching itself.
export const JARGON = new RegExp([
  "pony[t]ail", //               code-minimizing persona: skill name and its comment tag
  "shrin[k]:", //                 shrink-later comment tag
  "cavema[n]", //                 terse-prose persona
  "an[d]x", //                    skill family: tags, slash commands, run branches
  "\\.worktree[s][\\\\/]", //     local worktree paths (POSIX or Windows)
  "exe[c]-[a-z0-9-]*20\\d{6}", // run ids and branch stamps with a date
].join("|"), "i");

const scan = (label, lines, first = 1) =>
  lines.flatMap((l, i) => (JARGON.test(l) ? [`${label}:${first + i}: ${l.trim()}`] : []));

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.error?.message}`);
  return r.stdout;
}

// Added lines per file from a -U0 diff; hunk counts decide what is a header, so an added
// line that itself starts with "++" is still read as content.
function addedLines(diff) {
  const out = [];
  let file = null, ln = 0, oldLeft = 0, newLeft = 0;
  for (const l of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (l[0] === "+") { out.push({ file, line: ln++, text: l.slice(1) }); newLeft--; }
      else if (l[0] === "-") oldLeft--;
      continue;
    }
    const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) [oldLeft, ln, newLeft] = [Number(h[1] ?? 1), Number(h[2]), Number(h[3] ?? 1)];
    else if (l.startsWith("+++ ")) file = l.slice(4).replace(/^b\//, "");
  }
  return out;
}

function diffHits(base, head, repo, allowSkillText) {
  const diff = git(repo, "-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", `${base}...${head}`);
  const skillDir = new Map();
  const isSkill = (top) => {
    if (!skillDir.has(top)) skillDir.set(top, spawnSync("git", ["-C", repo, "cat-file", "-e", `${head}:${top}/SKILL.md`]).status === 0);
    return skillDir.get(top);
  };
  return addedLines(diff)
    .filter(({ file }) => !(allowSkillText && file.endsWith(".md") && file.includes("/") && isSkill(file.split("/")[0])))
    .flatMap(({ file, line, text }) => scan(file, [text], line));
}

export function main(argv) {
  const flags = new Set(argv.filter((a) => a === "--allow-skill-text"));
  const rest = argv.filter((a) => !flags.has(a));
  const ri = rest.indexOf("--repo");
  const repo = ri >= 0 ? rest.splice(ri, 2)[1] : ".";
  const [mode, a, b] = rest;
  let hits;
  try {
    if (mode === "diff" && a && b && repo && rest.length === 3) hits = diffHits(a, b, repo, flags.size > 0);
    else if (mode === "text" && a && rest.length === 2) hits = scan(a, fs.readFileSync(a === "-" ? 0 : path.resolve(a), "utf8").split(/\r?\n/));
    else if (argv.includes("--help")) return console.log(HELP), 0;
    else return console.error(HELP), 2;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (hits.length) console.log(hits.join("\n"));
  else console.log("clean: no jargon");
  return hits.length ? 1 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
