#!/usr/bin/env node
// Stand-in for worktrunk's wt: the subset worktree.mjs calls, output shaped like wt v0.81.0 --format json.
// FAKE_WT_LOG: append each argv as a JSON line. FAKE_WT_VERSION: --version text. FAKE_WT_UNAPPROVED=1:
// fail switch like wt does when .config/wt.toml hooks are not approved in a non-interactive shell.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

let args = process.argv.slice(2);
if (process.env.FAKE_WT_LOG) fs.appendFileSync(process.env.FAKE_WT_LOG, `${JSON.stringify(args)}\n`);
let cwd = process.cwd();
if (args[0] === "-C") [, cwd, ...args] = args;
const git = (...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const die = (msg) => {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
};

if (args[0] === "--version") console.log(process.env.FAKE_WT_VERSION ?? "wt v0.81.0");
else if (args[0] === "switch") {
  if (process.env.FAKE_WT_UNAPPROVED) {
    die("Cannot prompt for approval in non-interactive environment\n↳ To skip prompts in CI/CD, add --yes; to pre-approve commands, run wt config approvals add --yes");
  }
  const created = opt("--create");
  const branch = created ?? args[1];
  const r = created ? git("worktree", "add", "-b", branch, opt("--path"), opt("--base")) : git("worktree", "add", opt("--path"), branch);
  if (r.status !== 0) die(r.stderr.trim());
  console.log(JSON.stringify({ action: "created", branch, path: opt("--path"), created_branch: !!created }));
} else if (args[0] === "remove") {
  const branch = args[1];
  const rec = git("worktree", "list", "--porcelain").stdout.split(/\n\n+/).find((x) => x.includes(`\nbranch refs/heads/${branch}`));
  const p = rec?.split("\n")[0].slice("worktree ".length);
  const r = git("worktree", "remove", p ?? branch);
  if (r.status !== 0) die(`Cannot remove ${branch}: ${r.stderr.trim()}`);
  const keep = args.includes("--no-delete-branch") || git("merge-base", "--is-ancestor", branch, "HEAD").status !== 0;
  if (!keep) git("branch", "-D", branch);
  console.log(JSON.stringify([{ kind: "worktree", branch, path: p, branch_outcome: keep ? "retained_unmerged" : "deleted" }]));
} else if (args[0] === "step" && args[1] === "copy-ignored") {
  console.log(JSON.stringify({ outcome: "copied", entries: [{ path: "node_modules", kind: "dir" }] }));
} else if (args[0] === "step" && args[1] === "eval") {
  console.log("12345");
} else die(`fake wt: unsupported ${args.join(" ")}`);
