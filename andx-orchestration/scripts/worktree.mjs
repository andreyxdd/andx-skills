#!/usr/bin/env node
// Worktree lifecycle for a run: create (the one naming rule), remove, sweep.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { STALE_MS, TERMINAL, ledgerDir, newStamp, readLedger, runNames, writeLedger } from "./run.mjs";

const USAGE = `worktree: run worktrees under <primary checkout>/.worktrees/

  create --slug S [--wave N [--step ID]] [--stamp YYYYMMDD-HHMMSS] [--target BRANCH] [--baseline "<cmd>"]
      Name exec-S[-wN[-ID]]-STAMP: branch andx/<name>, folder .worktrees/<name>, started from TARGET_BRANCH
      (default: the run ledger's, else the primary checkout's branch). Without --wave and --stamp the run
      ledger's STAMP is reused, so the names equal what run.mjs start printed.
      Makes sure .worktrees/ is git-ignored (adds it to info/exclude and says so), seeds the worktree from
      the primary checkout's .worktreeinclude (gitignore syntax, shared with Claude Code and worktrunk: only
      untracked entries that are also git-ignored; copy-on-write, symlinks verbatim, existing files kept;
      prints SEED <n> entries <ms>ms), runs the primary checkout's .cursor/worktrees.json setup in the new
      worktree, then --baseline, and records seed, setup and baseline in the run ledger.
      Prints EXEC_BRANCH=, WORKTREE_DIR=, TARGET_BRANCH= lines. A failed git worktree add stops the run:
      there is no checkout fallback. The worktree is locked (reason "andx S <branch>") until remove, so no
      sweep or other tool deletes it mid-run. A symlinked .worktrees is refused (exit 2).
  create --slug S --branch B [--name N] [--track REMOTE/B]
      Worktree for an existing branch (an MR head) at .worktrees/N (default S), with the same lock, seed,
      setup and ledger entry; --track first resets B to REMOTE/B and tracks it. B checked out in the
      primary checkout: exit 2, stop and ask the user (never switch the primary checkout).
  remove <slug> [--wave N [--step ID]] [--target BRANCH]
      Unlocks the slug's own locks, removes its worktrees (run ones by name, --branch ones by lock; git
      refuses dirty ones) and deletes each run branch merged into TARGET_BRANCH (--branch ones are kept);
      prints git worktree list before and after.
  sweep [--apply] [--target BRANCH] [REPO]
      Lists agent worktrees. Safe = clean tree and branch merged into TARGET (default: current branch) or
      origin's default: an ancestor, or integrated (squash/rebase: merging it changes nothing). Dry run by
      default; --apply removes the safe ones. Dirty, unmerged or locked worktrees are never removed; the
      exact manual command is printed. Exception: an andx lock whose run ledger is terminal or untouched
      for 24h is a dead run (unlock dead-run); --apply unlocks it, then judges it like the rest.

Backend (create and remove print BACKEND=): git config andx.worktreeBackend, repo over global, set globally by
  node install.mjs --worktree-backend X. native (default): plain git. wt: worktrunk's wt switch / remove /
  step copy-ignored with the same names, locks and output (exit 3 if worktrunk is missing; Windows Terminal's
  wt is never run). auto: wt when found, else BACKEND=native (wt not found). wt always runs as wt -C <dir>
  without --yes: .config/wt.toml hooks not yet approved stop the run (exit 4) until the user runs
  wt config approvals add. Landing never uses wt merge (ship-queue.mjs land).

Common: --repo DIR (default cwd; any worktree of the repo). Slug: [a-z0-9-], max 40.
Exit: 0 ok, 1 remove refused or nothing to remove, 2 usage, 3 worktree add failed or worktrunk missing,
  4 setup failed or wt hooks unapproved.`;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// worktrunk ships as wt (git-wt where wt is taken). On Windows wt.exe under WindowsApps is Windows Terminal,
// which opens a window when run, so it is never executed.
export function wtCandidates(platform = process.platform, where = (n) => (spawnSync("where", [n], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/).filter(Boolean)) {
  return platform === "win32" ? [...where("git-wt"), ...where("wt").filter((p) => !/\\WindowsApps\\/i.test(p))] : ["wt", "git-wt"];
}
// stdin closed: wt sees no terminal, so it never prompts and unapproved hooks fail instead of waiting.
// A .cmd shim (tests on Windows) needs a shell; each argument is quoted for cmd.exe.
const runWt = (bin, args) => /\.(cmd|bat)$/i.test(bin)
  ? spawnSync([bin, ...args].map((a) => `"${a.replaceAll('"', '""')}"`).join(" "), { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] })
  : spawnSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
export const findWt = () => wtCandidates().find((b) => /\bwt v\d+\.\d+|worktrunk/.test(runWt(b, ["--version"]).stdout ?? ""));

// git config andx.worktreeBackend (repo overrides global): the wt binary, or undefined for native git.
function backend(root) {
  const want = git(root, "config", "--get", "andx.worktreeBackend").stdout.trim() || "native";
  if (!["native", "auto", "wt"].includes(want)) fail(2, `bad git config andx.worktreeBackend=${want}: native|auto|wt`);
  const bin = want === "native" ? undefined : findWt();
  if (want === "wt" && !bin) {
    fail(3, "andx.worktreeBackend=wt but worktrunk is not installed: brew install worktrunk (or cargo install worktrunk), or git config andx.worktreeBackend native");
  }
  console.log(`BACKEND=${bin ? "wt" : "native"}${want === "auto" && !bin ? " (wt not found)" : ""}`);
  return bin;
}
const wtJson = (r) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return undefined;
  }
};

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
  const lock = /^locked( |$)/m.test(rec) ? field("locked") : null;
  return { p: field("worktree"), head: field("HEAD"), branch: field("branch").replace(/^refs\/heads\//, ""), lock };
}).filter((w) => w.p);

// "merged" (ancestor), "integrated" (squash/rebase: merging changes nothing) or "".
function mergedInto(cwd, head, ref) {
  if (git(cwd, "merge-base", "--is-ancestor", head, ref).status === 0) return "merged";
  const m = git(cwd, "merge-tree", "--write-tree", ref, head);
  return m.status === 0 && m.stdout.split("\n")[0] === git(cwd, "rev-parse", `${ref}^{tree}`).stdout.trim() ? "integrated" : "";
}

// Claude Code's .worktreeinclude rule: an untracked entry is copied only if it matches the file and is git-ignored.
// verbatimSymlinks keeps relative links (node_modules/.bin) pointing inside the new worktree, not back at root.
// worktrunk's copy-ignored copies every ignored file when .worktreeinclude is absent, hence the guard and --require-include.
function seedFrom(root, dir, bin) {
  if (!fs.existsSync(path.join(root, ".worktreeinclude"))) return undefined;
  const t = performance.now();
  const done = (n) => {
    const seed = { entries: n, ms: Math.round(performance.now() - t) };
    console.log(`SEED ${seed.entries} entries ${seed.ms}ms`);
    return seed;
  };
  if (bin) {
    const r = runWt(bin, ["-C", dir, "step", "copy-ignored", "--require-include", "--format", "json"]);
    const out = wtJson(r);
    if (r.status !== 0 || !out) fail(4, `${r.stderr}wt step copy-ignored failed in ${dir}; stop before spawning workers`);
    return done(out.entries?.length ?? 0);
  }
  const listed = git(root, "ls-files", "-z", "--others", "--ignored", "--directory", "--exclude-from=.worktreeinclude").stdout.split("\0").filter(Boolean);
  const ignored = listed.length
    ? spawnSync("git", ["check-ignore", "-z", "--stdin"], { cwd: root, input: listed.join("\0"), encoding: "utf8" }).stdout.split("\0").filter(Boolean)
    : [];
  const real = fs.realpathSync(root);
  const inside = (rel) => {
    if ([".git", ".worktrees"].includes(rel.split("/")[0])) return false;
    try {
      const r = path.relative(real, fs.realpathSync(path.join(root, rel)));
      return !!r && !r.startsWith("..") && !path.isAbsolute(r);
    } catch {
      return false;
    }
  };
  const entries = ignored.map((e) => e.replace(/\/$/, "")).filter(inside);
  for (const e of entries) {
    fs.cpSync(path.join(root, e), path.join(dir, e), {
      recursive: true, mode: fs.constants.COPYFILE_FICLONE, verbatimSymlinks: true, force: false, preserveTimestamps: true,
    });
  }
  return done(entries.length);
}

function create(root, o) {
  const wtRoot = path.join(root, ".worktrees");
  if (fs.lstatSync(wtRoot, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fail(2, `${wtRoot} is a symlink: worktrees would live outside this checkout; replace it with a real directory`);
  }
  const bin = backend(root);
  const file = path.join(ledgerDir(root), `${o.slug}.json`);
  const ledger = readLedger(file);
  const target = o.target ?? ledger?.vars?.TARGET_BRANCH ?? git(root, "branch", "--show-current").stdout.trim();
  if (!target) fail(2, `primary checkout ${root} is not on a branch; pass --target`);
  const stamp = o.stamp ?? ((!o.wave && ledger?.vars?.STAMP) || newStamp());
  if (!/^\d{8}-\d{6}$/.test(stamp)) fail(2, `bad --stamp: ${stamp}`);
  const { EXEC_BRANCH: branch, WORKTREE_DIR: dir } = o.branch
    ? { EXEC_BRANCH: o.branch, WORKTREE_DIR: path.join(wtRoot, o.name ?? o.slug) }
    : runNames({ root, slug: o.slug, wave: o.wave, step: o.step, stamp });
  const name = path.basename(dir);
  if (o.branch && git(root, "branch", "--show-current").stdout.trim() === o.branch) {
    fail(2, `${o.branch} is checked out in the primary checkout ${root}: stop and ask the user; never switch the primary checkout`);
  }

  if (git(root, "check-ignore", "-q", ".worktrees/").status !== 0) {
    const ex = git(root, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").stdout.trim();
    fs.mkdirSync(path.dirname(ex), { recursive: true });
    const cur = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : "";
    fs.appendFileSync(ex, `${cur && !cur.endsWith("\n") ? "\n" : ""}.worktrees/\n`);
    console.log(`IGNORE added .worktrees/ to ${ex}`);
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const reason = `andx ${o.slug} ${branch}`;
  let hooks;
  if (bin) {
    if (o.track) {
      const t = git(root, "branch", "-f", "--track", branch, o.track);
      if (t.status !== 0) fail(3, `${t.stderr}git branch --track ${branch} ${o.track} failed; stop and report.`);
    }
    // The JSON on stdout says whether the worktree exists, even when a hook made wt exit non-zero.
    const pick = o.branch ? [branch] : ["--create", branch, "--base", target];
    hooks = runWt(bin, ["-C", root, "switch", ...pick, "--path", dir, "--no-cd", "--format", "json"]);
    if (!wtJson(hooks)?.path) {
      if (/approv/i.test(hooks.stderr)) {
        fail(4, `${hooks.stderr}worktrunk project hooks (.config/wt.toml) are not approved; never pass --yes. Review them, then run: wt -C '${root}' config approvals add`);
      }
      fail(3, `${hooks.stderr}wt switch failed: no checkout fallback; stop and report.`);
    }
    const lock = git(root, "worktree", "lock", "--reason", reason, dir);
    if (lock.status !== 0) fail(3, `${lock.stderr}git worktree lock failed; stop and report.`);
  } else {
    const pick = !o.branch ? ["-b", branch, dir, target] : o.track ? ["--track", "-B", branch, dir, o.track] : [dir, branch];
    const add = git(root, "worktree", "add", "--lock", "--reason", reason, ...pick);
    if (add.status !== 0) fail(3, `${add.stderr}git worktree add failed: no checkout fallback; stop and report.`);
  }
  console.log(`EXEC_BRANCH=${branch}\nWORKTREE_DIR=${dir}\nTARGET_BRANCH=${target}`);
  if (hooks && hooks.status !== 0) fail(4, `${hooks.stderr}wt switch hooks failed in ${dir}; stop before spawning workers`);

  const seed = seedFrom(root, dir, bin);

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
    data.worktrees = { ...data.worktrees, [name]: { EXEC_BRANCH: branch, WORKTREE_DIR: dir, TARGET_BRANCH: target, ...(seed && { seed }), ...(baseline && { baseline }) } };
    writeLedger(file, data);
    console.log(`LEDGER ${file}`);
  }
}

function remove(root, slug, o) {
  const bin = backend(root);
  const target = o.target ?? readLedger(path.join(ledgerDir(root), `${slug}.json`))?.vars?.TARGET_BRANCH
    ?? git(root, "branch", "--show-current").stdout.trim();
  const mid = o.wave ? `-w${o.wave}${o.step ? `-${o.step}` : "(?:-.+)?"}` : "(?:-w\\d+(?:-.+)?)?";
  const re = new RegExp(`^exec-${slug}${mid}-\\d{8}-\\d{6}$`);
  const list = () => git(root, "worktree", "list").stdout.trimEnd();
  git(root, "worktree", "prune");
  console.log(`# git worktree list (before)\n${list()}`);
  // Run worktrees match the naming rule; --branch worktrees only their lock, and their branch is never deleted.
  const ownLock = (w) => !!w.lock?.startsWith(`andx ${slug} `);
  const run = (w) => re.test(path.basename(w.p));
  const hits = worktrees(root).filter((w) => key(path.dirname(w.p)) === key(path.join(root, ".worktrees")) && (run(w) || (!o.wave && ownLock(w))));
  let refused = hits.length ? 0 : 1;
  if (!hits.length) console.log(`no worktree for ${slug} under ${path.join(root, ".worktrees")}`);
  for (const w of hits) {
    const { p, branch, lock } = w;
    const own = ownLock(w);
    if (own) git(root, "worktree", "unlock", p);
    const keepBranch = run(w) ? [] : ["--no-delete-branch"];
    const wtr = bin && branch ? runWt(bin, ["-C", root, "remove", branch, ...keepBranch, "--foreground", "--format", "json"]) : undefined;
    const r = wtr ?? git(root, "worktree", "remove", p);
    const out = wtr && wtJson(wtr)?.[0];
    if (wtr ? !out : r.status !== 0) {
      if (own) git(root, "worktree", "lock", "--reason", lock, p);
      refused = 1;
      console.log(`KEEP ${p}: ${r.stderr.trim()}\n        manual: git worktree remove --force '${p}'  # only after you confirm`);
      continue;
    }
    console.log(`REMOVED ${p}`);
    if (!branch || !run(w)) continue;
    // wt judges "merged" against its default branch; TARGET_BRANCH may differ, so a branch wt kept gets our check too.
    if (out?.branch_outcome === "deleted" || (target && mergedInto(root, branch, target) && git(root, "branch", "-D", branch).status === 0)) {
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
  const root = path.resolve(path.dirname(must(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")));
  must(repo, "worktree", "prune");
  target ||= must(repo, "branch", "--show-current");
  const remoteDefault = (git(repo, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").stdout ?? "").trim();
  const merged = (head) => mergedInto(repo, head, target) || (remoteDefault && mergedInto(repo, head, remoteDefault)) || "unmerged";
  // A lock without a readable ledger (hotfix, MR worktrees) stays: only a recorded end or 24h silence proves a run dead.
  const dead = (lock) => {
    const slug = /^andx ([a-z0-9-]+) /.exec(lock)?.[1];
    const f = slug && path.join(ledgerDir(root), `${slug}.json`);
    const l = f && readLedger(f);
    return !!l && (TERMINAL.includes(l.terminal) || Date.now() - fs.statSync(f).mtimeMs > STALE_MS);
  };

  let removed = 0, kept = 0;
  for (const { p, head, branch, lock } of worktrees(repo)) {
    if (key(p) === key(repo) || !agentPath(p, repo)) continue;
    if (lock !== null && !dead(lock)) {
      kept++;
      console.log(`keep    locked ${lock} ${branch || "detached"} ${p}\n        manual: git worktree unlock '${p}'  # only after you confirm the run is over`);
      continue;
    }
    if (lock !== null) {
      console.log(`unlock  dead-run ${lock} ${p}`);
      if (apply) must(repo, "worktree", "unlock", p);
    }
    const state = fs.existsSync(p) && git(p, "status", "--porcelain").stdout?.trim() ? "dirty" : "clean";
    const merge = merged(head);
    const action = state === "clean" && merge !== "unmerged" ? "remove" : "keep";
    console.log(`${action.padEnd(7)} ${state.padEnd(6)} ${merge.padEnd(8)} ${branch || "detached"} ${p}`);
    if (action === "remove" && apply) {
      must(repo, "worktree", "remove", p);
      if (branch) git(repo, "branch", "-D", branch);
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
        ...["repo", "slug", "wave", "step", "stamp", "target", "baseline", "branch", "name", "track"].map((k) => [k, { type: "string" }]),
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
  if ((o.name !== undefined || o.track !== undefined) && o.branch === undefined) fail(2, "--name and --track need --branch");
  if (o.branch !== undefined && (o.wave || git(".", "check-ref-format", "--branch", o.branch).status !== 0)) fail(2, `bad --branch (no --wave): ${o.branch}`);
  if (o.name !== undefined && !SLUG.test(o.name)) fail(2, `bad --name: ${o.name}`);
  const g = git(o.repo ?? ".", "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (g.status !== 0) fail(2, g.stderr || `not a git repo: ${o.repo ?? "."}`);
  const root = path.resolve(path.dirname(g.stdout.trim()));
  if (cmd === "create") create(root, { ...o, slug });
  else remove(root, slug, o);
}

if (import.meta.main) main(process.argv.slice(2));
