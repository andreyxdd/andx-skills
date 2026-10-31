#!/usr/bin/env node
// Claude PreToolUse + Cursor preToolUse guard: while a non-terminal run ledger exists for a repo,
// deny file edits in its primary checkout outside the .worktrees, .cursor/plans and .cursor/reviews folders.
// Edits inside linked worktrees always pass. Fail-open on any error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EDITS = new Set(["Write", "StrReplace", "Edit", "MultiEdit", "Delete", "NotebookEdit", "EditNotebook"]);
const OPEN = [".worktrees", ".cursor/plans", ".cursor/reviews"];
// Same cutoff as the Stop hook, so a crashed run does not lock the checkout for good.
const STALE_MS = 24 * 3600 * 1000;
const RUN = fileURLToPath(new URL("../andx-orchestration/scripts/run.mjs", import.meta.url));

const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

function decide({ TERMINAL, readLedger }, input, now = Date.now()) {
  if (!EDITS.has(String(input.tool_name ?? ""))) return null;
  const t = input.tool_input ?? {};
  const raw = t.file_path ?? t.path ?? t.notebook_path ?? t.target_notebook;
  if (typeof raw !== "string" || !raw) return null;
  let file = path.resolve(String(input.cwd ?? [input.workspace_roots ?? []].flat()[0] ?? "."), raw);

  // Real path of the deepest existing folder, so /var and /private/var compare equal to git's paths.
  let dir = path.dirname(file);
  const rest = [path.basename(file)];
  while (!isDir(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return null;
    rest.unshift(path.basename(dir));
    dir = up;
  }
  dir = fs.realpathSync.native(dir);
  file = path.join(dir, ...rest);

  const g = spawnSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (g.status !== 0) return null;
  const [top, gitDir, common] = g.stdout.trim().split("\n").map((l) => path.resolve(l));
  if (gitDir !== common) return null;
  const rel = path.relative(top, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  if (OPEN.some((o) => posix === o || posix.startsWith(`${o}/`))) return null;

  const runDir = path.join(top, ".worktrees", ".andx-run");
  if (!isDir(runDir)) return null;
  for (const f of fs.readdirSync(runDir)) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    const p = path.join(runDir, f);
    const data = readLedger(p);
    if (!data || TERMINAL.includes(String(data.terminal ?? ""))) continue;
    if (now - fs.statSync(p).mtimeMs > STALE_MS) continue;
    return { slug: String(data.slug ?? f.slice(0, -5)), ledger: p, top };
  }
  return null;
}

try {
  const hit = decide(await import("../andx-orchestration/scripts/run.mjs"), JSON.parse(fs.readFileSync(0, "utf8")));
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
