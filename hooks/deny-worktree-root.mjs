#!/usr/bin/env node
// Cursor preToolUse + beforeMCPExecution guard: deny move_agent_to_root /
// move_agent_to_cloned_root into an andx worktree (it opens a second Cursor workspace).
// Decides on the tool name only; file contents mentioning these words are ignored. Fail-open.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MOVE = /move_agent_to_(cloned_)?root$/;
const isHash = (v) => v != null && typeof v === "object" && !Array.isArray(v);

function decide(raw) {
  try {
    const input = JSON.parse(raw);
    let name = String(input.tool_name ?? "");
    let args = input.tool_input;
    if (name.endsWith("CallDynamicTool") && isHash(args)) {
      name = String(args.toolName ?? "");
      args = args.arguments;
    }
    if (!MOVE.test(name)) return "allow";
    try { fs.writeFileSync(path.join(os.tmpdir(), "andx-guard-last-stdin.json"), raw); } catch {}
    // Forward or (JSON-escaped) backslash separators, so Windows paths are caught too.
    return /[\\/]\.worktrees[\\/]/.test(typeof args === "string" ? args : JSON.stringify(args ?? null)) ? "deny" : "allow";
  } catch {
    return "allow";
  }
}

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch {}
if (decide(raw) === "deny") {
  console.log(JSON.stringify({
    permission: "deny",
    user_message: "andx: workers use absolute WORKTREE_DIR paths; do not move the workspace root into .worktrees/.",
    agent_message: "Denied: never move_agent_to_root into .worktrees/. Use absolute $WORKTREE_DIR paths or Shell working_directory instead.",
  }));
  process.exit(2);
}
