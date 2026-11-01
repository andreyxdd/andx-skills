#!/usr/bin/env node
// Claude PreToolUse + Cursor preToolUse guard: while a non-terminal run ledger exists for a repo,
// deny file edits in its primary checkout outside the .worktrees, .cursor/plans and .cursor/reviews folders.
// Edits inside linked worktrees always pass. Fail-open on any error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const EDITS = new Set(["Write", "StrReplace", "Edit", "MultiEdit", "Delete", "NotebookEdit", "EditNotebook"]);
const OPEN = [".worktrees", ".cursor/plans", ".cursor/reviews"];
const RUN = fileURLToPath(new URL("../andx-orchestration/scripts/run.mjs", import.meta.url));

const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

// Where an edit really lands: symlinks resolved (a dangling one through its link text), missing tail kept.
function real(p, hops = 0) {
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(p), ...rest);
    } catch {}
    if (hops > 40) return null;
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) return real(path.join(path.resolve(path.dirname(p), fs.readlinkSync(p)), ...rest), hops + 1);
    const up = path.dirname(p);
    if (up === p) return null;
    rest.unshift(path.basename(p));
    p = up;
  }
}

const revParse = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, "rev-parse", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout.trim().split("\n").map((l) => path.resolve(l)) : null;
};

function decide({ TERMINAL, STALE_MS, ledgers, readLedger }, input) {
  if (!EDITS.has(String(input.tool_name ?? ""))) return null;
  const t = input.tool_input ?? {};
  const raw = t.file_path ?? t.path ?? t.notebook_path ?? t.target_notebook;
  if (typeof raw !== "string" || !raw) return null;
  const file = real(path.resolve(String(input.cwd ?? [input.workspace_roots ?? []].flat()[0] ?? "."), raw));
  if (!file) return null;
  let dir = path.dirname(file);
  while (!isDir(dir)) dir = path.dirname(dir);

  const dirs = revParse(dir, "--path-format=absolute", "--git-dir", "--git-common-dir");
  if (!dirs || dirs[0] !== dirs[1]) return null;
  // --show-toplevel fails inside the git dir itself; its parent is the checkout then.
  const top = revParse(dir, "--show-toplevel")?.[0] ?? path.dirname(dirs[1]);
  const rel = path.relative(top, file);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  if (OPEN.some((o) => posix === o || posix.startsWith(`${o}/`))) return null;

  for (const p of ledgers(top)) {
    const data = readLedger(p);
    if (!data || TERMINAL.includes(String(data.terminal ?? ""))) continue;
    if (Date.now() - fs.statSync(p).mtimeMs > STALE_MS) continue;
    return { slug: String(data.slug ?? path.basename(p, ".json")), ledger: p, top };
  }
  return null;
}

try {
  const hit = decide(await import(pathToFileURL(RUN).href), JSON.parse(fs.readFileSync(0, "utf8")));
  if (hit) {
    const why = `Run '${hit.slug}' is active (${hit.ledger}): the primary checkout is read-only outside .worktrees/, .cursor/plans/ and .cursor/reviews/.`;
    const fix = `Edit in the run's worktree with absolute WORKTREE_DIR paths, or end the run: node "${RUN}" end ${hit.slug} --terminal ABORTED --repo "${hit.top}"`;
    console.log(JSON.stringify({ permission: "deny", user_message: why, agent_message: `Denied. ${why} ${fix}` }));
    console.error(`${why} ${fix}`);
    process.exitCode = 2;
  }
} catch {
  // fail-open
}
