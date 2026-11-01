import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "spawn.mjs");
const unix = { skip: process.platform === "win32" && "fake CLIs are shebang scripts" };
let dir, bin, repo, promptFile;

// A fake CLI that reports how it was called; FAKE_WRITE makes it edit its cwd like a misbehaving agent.
const FAKE = `#!/usr/bin/env node
const fs = require("fs");
const stdin = fs.readFileSync(0, "utf8");
if (process.env.FAKE_WRITE) fs.writeFileSync("touched.txt", "x");
console.log(JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`;

function spawn(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, call: r.status === 0 || r.status === 7 ? JSON.parse(r.stdout) : null };
}
const base = (...extra) => ["--agent", "andx-spec-reviewer", "--cwd", repo, "--prompt-file", promptFile, ...extra];

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "spawn-")));
  bin = join(dir, "bin");
  repo = join(dir, "repo");
  fs.mkdirSync(bin);
  fs.mkdirSync(repo);
  for (const c of ["claude", "codex", "pi", "kimi"]) fs.writeFileSync(join(bin, c), FAKE, { mode: 0o755 });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  promptFile = join(dir, "prompt.md");
  fs.writeFileSync(promptFile, "DIFF: +a\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("read-only flags per CLI; prompt is the agent body then the prompt file", unix, () => {
  const body = fs.readFileSync(join(dirname(SCRIPT), "..", "..", "agents", "andx-spec-reviewer.md"), "utf8").split(/^---$/m).slice(2).join("---").trim();
  const want = {
    claude: ["-p", "Follow the instructions given on stdin.", "--disallowedTools", "Edit", "Write", "NotebookEdit"],
    codex: ["exec", "--sandbox", "read-only", "-"],
    pi: ["-p", "--no-session", "--tools", "read,grep,find,ls", "Follow the instructions given on stdin."],
  };
  for (const [cli, argv] of Object.entries(want)) {
    const r = spawn(base("--cli", cli, "--readonly"));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.call.argv, argv, cli);
    assert.equal(r.call.stdin, `${body}\n\nDIFF: +a\n`, cli);
    assert.equal(r.call.cwd, repo, cli);
  }
});

test("writable runs: codex workspace-write, kimi prompt in argv; git config picks the CLI", unix, () => {
  assert.deepEqual(spawn(base("--cli", "codex")).call.argv, ["exec", "--sandbox", "workspace-write", "-"]);
  const k = spawn(base("--cli", "kimi"));
  assert.equal(k.call.argv[0], "-p");
  assert.match(k.call.argv[1], /DIFF: \+a\n$/);
  assert.equal(k.call.stdin, "");
  spawnSync("git", ["config", "--file", join(dir, "gitconfig"), "andx.spawnCli", "pi"]);
  assert.deepEqual(spawn(base()).call.argv, ["-p", "--no-session", "Follow the instructions given on stdin."]);
});

test("refusals: no CLI, unknown CLI, kimi read-only, unknown agent, missing args", unix, () => {
  assert.match(spawn(base()).err, /no CLI: pass --cli/);
  assert.equal(spawn(base()).code, 2);
  assert.equal(spawn(base("--cli", "gemini")).code, 2);
  const k = spawn(base("--cli", "kimi", "--readonly"));
  assert.equal(k.code, 2);
  assert.match(k.err, /spawn the named agent andx-spec-reviewer/);
  assert.equal(spawn(["--agent", "../x", "--cwd", repo, "--prompt-file", promptFile, "--cli", "pi"]).code, 2);
  assert.equal(spawn(["--agent", "nope", "--cwd", repo, "--prompt-file", promptFile, "--cli", "pi"]).code, 2);
  assert.equal(spawn(["--cli", "pi"]).code, 2);
});

test("a read-only agent that changes its cwd exits 3; the CLI's exit code passes through", unix, () => {
  const r = spawn(base("--cli", "claude", "--readonly"), { FAKE_WRITE: "1" });
  assert.equal(r.code, 3);
  assert.match(r.err, /changed .* discard its result/);
  fs.rmSync(join(repo, "touched.txt"));
  assert.equal(spawn(base("--cli", "codex"), { FAKE_WRITE: "1" }).code, 0, "writable runs may edit");
  assert.equal(spawn(base("--cli", "pi", "--readonly"), { FAKE_EXIT: "7" }).code, 7);
});
