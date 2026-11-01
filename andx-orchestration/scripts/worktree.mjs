#!/usr/bin/env node
// Worktree lifecycle for a run: create (the one naming rule), remove, sweep.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { ledgerDir, newStamp, readLedger, runNames, writeLedger } from "./run.mjs";

const USAGE = `worktree: run worktrees under <primary checkout>/.worktrees/

  create --slug S [--wave N [--step ID]] [--stamp YYYYMMDD-HHMMSS] [--target BRANCH] [--baseline "<cmd>"]
      Name exec-S[-wN[-ID]]-STAMP: branch andx/<name>, folder .worktrees/<name>, started from TARGET_BRANCH
      (default: the run ledger's, else the primary checkout's branch). Without --wave and --stamp the run
      ledger's STAMP is reused, so the names equal what run.mjs start printed.
      Makes sure .worktrees/ is git-ignored (adds it to info/exclude and says so), runs the primary checkout's
      .cursor/worktrees.json setup in the new worktree, then --baseline, and records both in the run ledger.
      Prints EXEC_BRANCH=, WORKTREE_DIR=, TARGET_BRANCH= lines. A failed git worktree add stops the run:
      there is no checkout fallback.
  remove <slug> [--wave N [--step ID]] [--target BRANCH]
      Removes the slug's worktrees (git refuses dirty ones) and deletes each branch already merged into
      TARGET_BRANCH; prints git worktree list before and after.
  sweep [--apply] [--target BRANCH] [REPO]
      Lists agent worktrees. Safe = clean tree and branch tip merged into TARGET (default: current branch)
      or origin's default. Dry run by default; --apply removes the safe ones. Dirty or unmerged worktrees
      are never removed; the exact manual command is printed. Ancestry check only, so squash/rebase-merged
      MRs show as unmerged (kept).

Common: --repo DIR (default cwd; any worktree of the repo). Slug: [a-z0-9-], max 40.
Exit: 0 ok, 1 remove refused or nothing to remove, 2 usage, 3 git worktree add failed, 4 setup failed.`;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// Comparable form: resolved, native separators, lower-cased where the filesystem is case-insensitive (win32).
const key = (p, P = path) => (P.sep === "\\" ? P.resolve(p).toLowerCase() : P.resolve(p));

export function agentPath(p, repo, P = path) {
  const rel = P.relative(key(P.join(repo, ".worktrees"), P), key(p, P));
  const s = key(p, P).split(P.sep).join("/");
  return (!!rel && !rel.startsWith("..") && !P.isAbsolute(rel))
    || s.includes("-exec") || ["/restack-", "/review-", "/exec-"].some((x) => s.includes(x));
}

const worktrees = (root) => git(root, "worktree", "list", "--porcelain").stdout.split(/\n\n+/).map((rec) => {
  const field = (k) => rec.split("\n").find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? "";
  return { p: field("worktree"), head: field("HEAD"), branch: field("branch").replace(/^refs\/heads\//, "") };
}).filter((w) => w.p);

function create(root, o) {
  const file = path.join(ledgerDir(root), `${o.slug}.json`);
  const ledger = readLedger(file);
  const target = o.target ?? ledger?.vars?.TARGET_BRANCH ?? git(root, "branch", "--show-current").stdout.trim();
  if (!target) fail(2, `primary checkout ${root} is not on a branch; pass --target`);
  const stamp = o.stamp ?? ((!o.wave && ledger?.vars?.STAMP) || newStamp());
  if (!/^\d{8}-\d{6}$/.test(stamp)) fail(2, `bad --stamp: ${stamp}`);
  const { EXEC_BRANCH: branch, WORKTREE_DIR: dir } = runNames({ root, slug: o.slug, wave: o.wave, step: o.step, stamp });
  const name = path.basename(dir);

  if (git(root, "check-ignore", "-q", ".worktrees/").status !== 0) {
    const ex = git(root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").stdout.trim();
    fs.mkdirSync(path.dirname(ex), { recursive: true });
    const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : "";
    fs.appendFileSync(ex, `${cur && !cur.endsWith("\n") ? "\n" : ""}.worktrees/\n`);
    console.log(`IGNORE added .worktrees/ to ${ex}`);
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const add = git(root, "worktree", "add", "-b", branch, dir, target);
  if (add.status !== 0) fail(3, `${add.stderr}git worktree add failed: no checkout fallback; stop and report.`);
  console.log(`EXEC_BRANCH=${branch}\nWORKTREE_DIR=${dir}\nTARGET_BRANCH=${target}`);

  // Setup comes from the primary checkout only: a branch's copy is untrusted.
  const cfg = path.join(root, ".cursor", "worktrees.json");
  if (fs.existsSync(cfg)) {
    let s;
    try {
      const c = JSON.parse(fs.readFileSync(cfg, "utf8"));
      s = c[process.platform === "win32" ? "setup-worktree-windows" : "setup-worktree-unix"] ?? c["setup-worktree"];
    } catch (e) {
      fail(4, `bad ${cfg}: ${e.message}`);
    }
    const cmds = typeof s === "string" ? [JSON.stringify(path.resolve(root, ".cursor", s))] : Array.isArray(s) ? s : [];
    for (const c of cmds) {
      console.log(`SETUP $ ${c}`);
      const r = spawnSync(c, { cwd: dir, shell: true, stdio: ["ignore", 2, 2], env: { ...process.env, ROOT_WORKTREE_PATH: root } });
      console.log(`SETUP exit=${r.status} ${c}`);
      if (r.status !== 0) fail(4, `setup failed in ${dir}; stop before spawning workers`);
    }
  }

  let baseline;
  if (o.baseline) {
    const r = spawnSync(o.baseline, { cwd: dir, shell: true, stdio: ["ignore", 2, 2] });
    baseline = { cmd: o.baseline, exit: r.status, red: r.status !== 0 };
    console.log(`BASELINE exit=${r.status} ${baseline.red ? "red" : "green"}`);
  }

  // Read-modify-write without a lock: parallel creates for one slug can drop each other's entry,
  // so the parent creates a wave's worktrees one after another.
  const data = readLedger(file);
  if (data) {
    data.worktrees = { ...data.worktrees, [name]: { EXEC_BRANCH: branch, WORKTREE_DIR: dir, TARGET_BRANCH: target, ...(baseline && { baseline }) } };
    writeLedger(file, data);
    console.log(`LEDGER ${file}`);
  }
}

function remove(root, slug, o) {
  const target = o.target ?? readLedger(path.join(ledgerDir(root), `${slug}.json`))?.vars?.TARGET_BRANCH
    ?? git(root, "branch", "--show-current").stdout.trim();
  const mid = o.wave ? `-w${o.wave}${o.step ? `-${o.step}` : "(?:-.+)?"}` : "(?:-w\\d+(?:-.+)?)?";
  const re = new RegExp(`^exec-${slug}${mid}-\\d{8}-\\d{6}$`);
  const list = () => git(root, "worktree", "list").stdout.trimEnd();
  git(root, "worktree", "prune");
  console.log(`# git worktree list (before)\n${list()}`);
  const hits = worktrees(root).filter((w) => key(path.dirname(w.p)) === key(path.join(root, ".worktrees")) && re.test(path.basename(w.p)));
  let refused = hits.length ? 0 : 1;
  if (!hits.length) console.log(`no worktree for ${slug} under ${path.join(root, ".worktrees")}`);
  for (const { p, branch } of hits) {
    const r = git(root, "worktree", "remove", p);
    if (r.status !== 0) {
      refused = 1;
      console.log(`KEEP ${p}: ${r.stderr.trim()}\n        manual: git worktree remove --force '${p}'  # only after you confirm`);
      continue;
    }
    console.log(`REMOVED ${p}`);
    if (!branch) continue;
    if (target && git(root, "merge-base", "--is-ancestor", branch, target).status === 0 && git(root, "branch", "-D", branch).status === 0) {
      console.log(`DELETED branch ${branch}`);
    } else {
      refused = 1;
      console.log(`KEEP branch ${branch}: not merged into ${target || "TARGET_BRANCH"}\n        manual: git branch -D '${branch}'  # only after you confirm`);
    }
  }
  console.log(`# git worktree list (after)\n${list()}`);
  process.exit(refused);
}

function sweep(apply, target, repo) {
  const must = (cwd, ...a) => {
    const r = git(cwd, ...a);
    if (r.status !== 0) fail(r.status ?? 1, (r.stderr || r.error?.message || "git failed").trimEnd());
    return r.stdout.trim();
  };

  repo = must(repo, "rev-parse", "--show-toplevel");
  must(repo, "worktree", "prune");
  target ||= must(repo, "branch", "--show-current");
  const remoteDefault = (git(repo, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").stdout ?? "").trim();
  const ancestor = (head, ref) => git(repo, "merge-base", "--is-ancestor", head, ref).status === 0;
  const merged = (head) => ancestor(head, target) || (!!remoteDefault && ancestor(head, remoteDefault));

  let removed = 0, kept = 0;
  for (const { p, head, branch } of worktrees(repo)) {
    if (key(p) === key(repo) || !agentPath(p, repo)) continue;
    const state = fs.existsSync(p) && git(p, "status", "--porcelain").stdout?.trim() ? "dirty" : "clean";
    const merge = merged(head) ? "merged" : "unmerged";
    const action = state === "clean" && merge === "merged" ? "remove" : "keep";
    console.log(`${action.padEnd(7)} ${state.padEnd(6)} ${merge.padEnd(8)} ${branch || "detached"} ${p}`);
    if (action === "remove" && apply) {
      must(repo, "worktree", "remove", p);
      if (branch) git(repo, "branch", "-d", branch);
      removed++;
    } else if (action === "keep") {
      kept++;
      console.log(`        manual: git worktree remove --force '${p}'${branch ? ` && git branch -D '${branch}'` : ""}  # only after you confirm`);
    }
  }

  console.log(`target=${target} removed=${removed} kept=${kept} apply=${apply}`);
}

function main(args) {
  let o, cmd, arg;
  try {
    ({ values: o, positionals: [cmd, arg] } = parseArgs({
      args,
      allowPositionals: true,
      options: Object.fromEntries([
        ...["repo", "slug", "wave", "step", "stamp", "target", "baseline"].map((k) => [k, { type: "string" }]),
        ["apply", { type: "boolean" }],
        ["help", { type: "boolean", short: "h" }],
      ]),
    }));
  } catch (e) {
    fail(2, `${e.message}\n\n${USAGE}`);
  }
  if (o.help) return console.log(USAGE);
  if (cmd === "sweep") return sweep(o.apply ? 1 : 0, o.target ?? "", arg ?? o.repo ?? ".");
  if (!["create", "remove"].includes(cmd)) fail(2, USAGE);

  const slug = cmd === "create" ? o.slug : arg;
  if (!SLUG.test(slug ?? "")) fail(2, `bad or missing slug: ${slug ?? ""}\n\n${USAGE}`);
  if (o.wave !== undefined && !/^\d+$/.test(o.wave)) fail(2, `bad --wave: ${o.wave}`);
  if (o.step !== undefined && (!o.wave || !SLUG.test(o.step))) fail(2, `--step needs --wave and [a-z0-9-]: ${o.step}`);
  const g = git(o.repo ?? ".", "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo ?? "."}`);
  const root = path.resolve(path.dirname(g.stdout.trim()));
  if (cmd === "create") create(root, { ...o, slug });
  else remove(root, slug, o);
}

if (import.meta.main) main(process.argv.slice(2));
