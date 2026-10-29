#!/usr/bin/env node
// List agent worktrees and remove the safe ones.
//   node worktree-sweep.mjs [--apply] [--target BRANCH] [REPO]
// Safe = clean tree AND branch tip merged into TARGET (default: current branch) or origin's default.
// Dry-run by default. Dirty or unmerged worktrees are never removed; the exact manual command is printed.
// Ancestry check only, so squash/rebase-merged MRs show as "unmerged" (kept). Upgrade: ask host API for merged MR by branch.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Comparable form: resolved, native separators, lower-cased where the filesystem is case-insensitive (win32).
const key = (p, P = path) => (P.sep === "\\" ? P.resolve(p).toLowerCase() : P.resolve(p));

export function agentPath(p, repo, P = path) {
  const rel = P.relative(key(P.join(repo, ".worktrees"), P), key(p, P));
  const s = key(p, P).split(P.sep).join("/");
  return (!!rel && !rel.startsWith("..") && !P.isAbsolute(rel))
    || s.includes("-exec") || ["/restack-", "/review-", "/exec-"].some((x) => s.includes(x));
}

function main(args) {
  let apply = 0, target = "", repo = ".";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = 1;
    else if (args[i] === "--target") target = args[++i] ?? "";
    else repo = args[i];
  }

  const git = (a, { check = true } = {}) => {
    const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
    if (check && r.status !== 0) {
      process.stderr.write(r.stderr);
      process.exit(r.status ?? 1);
    }
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
  };

  repo = git(["rev-parse", "--show-toplevel"]).out;
  git(["worktree", "prune"]);
  target ||= git(["branch", "--show-current"]).out;
  const remoteDefault = git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { check: false }).out;
  const ancestor = (head, ref) => git(["merge-base", "--is-ancestor", head, ref], { check: false }).ok;
  const merged = (head) => ancestor(head, target) || (!!remoteDefault && ancestor(head, remoteDefault));

  let removed = 0, kept = 0;
  for (const rec of git(["worktree", "list", "--porcelain"]).out.split(/\n\n+/)) {
    const field = (k) => rec.split("\n").find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? "";
    const p = field("worktree"), head = field("HEAD"), branch = field("branch").replace(/^refs\/heads\//, "");
    if (!p || key(p) === key(repo) || !agentPath(p, repo)) continue;
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
}

if (import.meta.main) main(process.argv.slice(2));
