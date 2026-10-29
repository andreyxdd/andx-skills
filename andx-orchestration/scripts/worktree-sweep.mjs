#!/usr/bin/env node
// List agent worktrees and remove the safe ones.
//   node worktree-sweep.mjs [--apply] [--target BRANCH] [REPO]
// Safe = clean tree AND branch tip merged into TARGET (default: current branch) or origin's default.
// Dry-run by default. Dirty or unmerged worktrees are never removed; the exact manual command is printed.
// Ancestry check only, so squash/rebase-merged MRs show as "unmerged" (kept). Upgrade: ask host API for merged MR by branch.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

let apply = 0, target = "", repo = ".";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") apply = 1;
  else if (args[i] === "--target") target = args[++i] ?? "";
  else repo = args[i];
}

function git(a, { cwd = repo, check = true } = {}) {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (check && r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

repo = git(["rev-parse", "--show-toplevel"]).out;
git(["worktree", "prune"]);
target ||= git(["branch", "--show-current"]).out;
const remoteDefault = git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { check: false }).out;
const ancestor = (head, ref) => git(["merge-base", "--is-ancestor", head, ref], { check: false }).ok;
const merged = (head) => ancestor(head, target) || (!!remoteDefault && ancestor(head, remoteDefault));
const agentPath = (p) => p.startsWith(`${repo}/.worktrees/`) || p.includes("-exec") || ["/restack-", "/review-", "/exec-"].some((s) => p.includes(s));

let removed = 0, kept = 0;
const records = git(["worktree", "list", "--porcelain"]).out.split(/\n\n+/);
for (const rec of records) {
  const field = (k) => rec.split("\n").find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? "";
  const p = field("worktree"), head = field("HEAD"), branch = field("branch").replace(/^refs\/heads\//, "");
  if (!p || p === repo || !agentPath(p)) continue;
  const state = fs.existsSync(p) && git(["-C", p, "status", "--porcelain"], { check: false }).out ? "dirty" : "clean";
  const merge = merged(head) ? "merged" : "unmerged";
  const action = state === "clean" && merge === "merged" ? "remove" : "keep";
  console.log(`${action.padEnd(7)} ${state.padEnd(6)} ${merge.padEnd(8)} ${branch || "detached"} ${p}`);
  if (action === "remove" && apply) {
    git(["worktree", "remove", p]);
    if (branch) git(["branch", "-d", branch], { check: false });
    removed++;
  } else if (action === "keep") {
    kept++;
    console.log(`        manual: git worktree remove --force '${p}'${branch ? ` && git branch -D '${branch}'` : ""}  # only after you confirm`);
  }
}

console.log(`target=${target} removed=${removed} kept=${kept} apply=${apply}`);
