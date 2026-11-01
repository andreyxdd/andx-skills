#!/usr/bin/env node
// Run one andx agent through a harness's own headless CLI: the spawn path for harnesses without
// named (read-only) subagents. See ../HARNESS.md#spawn.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const AGENTS = fileURLToPath(new URL("../../agents/", import.meta.url));
const ASK = "Follow the instructions given on stdin.";
// Full prompt on stdin (argv caps one argument at 128 KiB on Linux); argv per CLI, read-only first.
const CLIS = {
  claude: (ro) => ["claude", ["-p", ASK, ...(ro ? ["--disallowedTools", "Edit", "Write", "NotebookEdit"] : [])]],
  codex: (ro) => ["codex", ["exec", "--sandbox", ro ? "read-only" : "workspace-write", "-"]],
  pi: (ro) => ["pi", ["-p", "--no-session", ...(ro ? ["--tools", "read,grep,find,ls"] : []), ASK]],
  // Kimi: prompt in argv (stdin input unverified); no read-only flag, so read-only roles use Kimi's named agents.
  kimi: (ro, prompt) => (ro ? null : ["kimi", ["-p", prompt]]),
};

const USAGE = `spawn: run an andx agent (agents/<NAME>.md body + prompt file) through a headless CLI

  node spawn.mjs --agent NAME --cwd DIR --prompt-file F [--cli ${Object.keys(CLIS).join("|")}] [--readonly]

  --cli       default: git config andx.spawnCli; neither set exits 2
  --readonly  claude: --disallowedTools Edit Write NotebookEdit; codex: exec --sandbox read-only;
              pi: --tools read,grep,find,ls (no bash: put the diff in the prompt file); kimi: refused (exit 2).
              Afterwards DIR's git status must be unchanged, else exit 3.
Stdout is the agent's stdout. Exit: the CLI's code, 2 usage, 3 read-only agent changed DIR.`;

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const status = (cwd) => spawnSync("git", ["-C", cwd, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" }).stdout ?? "";

let o;
try {
  ({ values: o } = parseArgs({
    options: { agent: { type: "string" }, cwd: { type: "string" }, "prompt-file": { type: "string" }, cli: { type: "string" }, readonly: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  }));
} catch (e) {
  fail(2, `${e.message}\n\n${USAGE}`);
}
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!o.agent || !o.cwd || !o["prompt-file"]) fail(2, `--agent, --cwd and --prompt-file are required\n\n${USAGE}`);
if (!/^[a-z0-9-]+$/.test(o.agent)) fail(2, `bad agent name: ${o.agent}`);
const file = path.join(AGENTS, `${o.agent}.md`);
if (!fs.existsSync(file)) fail(2, `no agent ${file}`);
const cli = o.cli ?? (spawnSync("git", ["config", "andx.spawnCli"], { encoding: "utf8" }).stdout.trim() || null);
if (!cli) fail(2, `no CLI: pass --cli ${Object.keys(CLIS).join("|")} or set git config --global andx.spawnCli`);
if (!Object.hasOwn(CLIS, cli)) fail(2, `unknown CLI ${cli} (${Object.keys(CLIS).join("|")})`);

const body = fs.readFileSync(file, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
const prompt = `${body}\n\n${fs.readFileSync(o["prompt-file"], "utf8")}`;
const cmd = CLIS[cli](!!o.readonly, prompt);
if (!cmd) fail(2, `${cli} has no read-only headless mode; spawn the named agent ${o.agent} instead (HARNESS.md#spawn)`);

const before = o.readonly ? status(o.cwd) : null;
// ponytail: no shell, so Windows .cmd shims (npm installs) fail to start; set andx.spawnCli on WSL or use the .exe.
const r = spawnSync(cmd[0], cmd[1], { cwd: o.cwd, input: cli === "kimi" ? "" : prompt, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
if (r.error) fail(2, `${cmd[0]}: ${r.error.message}`);
if (o.readonly && status(o.cwd) !== before) fail(3, `read-only agent ${o.agent} changed ${o.cwd} (git status differs); discard its result`);
process.exit(r.status ?? 1);
