#!/usr/bin/env node
// Postcondition: babysit never resolves human-authored review threads.
//   node thread-guard.mjs BEFORE.json AFTER.json [--bots a,b,c]
// Each file: [{"id":"...","author":"login","resolved":false}, ...] (normalize gh/glab output to this shape).
// Exit 1 and list ids when a human thread unresolved in BEFORE is resolved in AFTER.
import fs from "node:fs";

const BOTS = ["cursor", "bugbot", "aikido", "coderabbitai", "sonarcloud", "gitlab-bot", "github-actions"];

function isBot(author, bots) {
  const a = String(author ?? "").toLowerCase().replace(/\[bot\]$/, "");
  return bots.some((b) => a === b || a.startsWith(`${b}-`));
}

function violations(before, after, bots = BOTS) {
  const openHuman = before.filter((t) => !t.resolved && !isBot(t.author, bots)).map((t) => t.id);
  const nowResolved = new Set(after.filter((t) => t.resolved).map((t) => t.id));
  return [...new Set(openHuman.filter((id) => nowResolved.has(id)))];
}

const argv = process.argv.slice(2);
const [before, after] = argv.slice(0, 2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const i = argv.indexOf("--bots");
const bad = violations(before, after, i >= 0 ? [...BOTS, ...(argv[i + 1] ?? "").split(",")] : BOTS);
if (bad.length) {
  console.log(`thread-guard: FAIL human threads resolved by agent: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("thread-guard: PASS");
