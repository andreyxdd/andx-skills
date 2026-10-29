import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function hook(name, stdin) {
  const r = spawnSync(process.execPath, [join(here, name)], { encoding: "utf8", input: stdin });
  return { code: r.status, out: r.stdout };
}

let dir, run, transcript;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hooks-"));
  run = join(dir, ".worktrees", ".andx-run");
  mkdirSync(run, { recursive: true });
  transcript = join(dir, "t.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function ledger(slug, extra = {}) {
  const p = join(run, `${slug}.json`);
  writeFileSync(p, JSON.stringify({ slug, mode: "review", phase: "C", continues: 0, terminal: null, ...extra }));
  return p;
}
const cont = (input = { cwd: dir, transcript_path: transcript }) => hook("andx-continue.mjs", JSON.stringify(input));

test("continue: non-terminal ledger in transcript blocks and counts", () => {
  const p = ledger("feat");
  writeFileSync(transcript, "wrote .worktrees/.andx-run/feat.json");
  const { code, out } = cont();
  assert.equal(code, 0);
  const res = JSON.parse(out);
  assert.equal(res.decision, "block");
  assert.match(res.reason, /'feat' \(mode review\) is at phase C, not terminal\..* Continue 1\/5\.$/);
  assert.equal(JSON.parse(readFileSync(p, "utf8")).continues, 1);
});

test("continue: terminal allows", () => {
  ledger("feat", { terminal: "DONE" });
  writeFileSync(transcript, ".andx-run/feat.json");
  assert.deepEqual(cont(), { code: 0, out: "" });
});

test("continue: cap allows", () => {
  ledger("feat", { continues: 5 });
  writeFileSync(transcript, ".andx-run/feat.json");
  assert.deepEqual(cont(), { code: 0, out: "" });
});

test("continue: other conversation ledger ignored", () => {
  ledger("other");
  writeFileSync(transcript, "nothing about it");
  assert.deepEqual(cont(), { code: 0, out: "" });
});

test("continue: missing transcript fails open", () => {
  ledger("feat");
  assert.deepEqual(cont({ cwd: dir }), { code: 0, out: "" });
});

test("continue: non-object ledger skipped", () => {
  writeFileSync(join(run, "arr.json"), "[1]");
  writeFileSync(transcript, ".andx-run/arr.json");
  assert.deepEqual(cont(), { code: 0, out: "" });
});

test("continue: malformed stdin fails open", () => {
  assert.deepEqual(hook("andx-continue.mjs", "not json {{"), { code: 0, out: "" });
});

const guard = (input) => hook("deny-worktree-root.mjs", typeof input === "string" ? input : JSON.stringify(input)).code;

test("guard: edit mentioning words allowed", () => {
  assert.equal(guard({ tool_name: "StrReplace", tool_input: { new_string: "never move_agent_to_root into /r/.worktrees/x" } }), 0);
});

test("guard: mcp cloned root denied", () => {
  const r = hook("deny-worktree-root.mjs", JSON.stringify({ tool_name: "MCP:move_agent_to_cloned_root", tool_input: '{"rootPath":"/r/.worktrees/exec-y"}' }));
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.out).permission, "deny");
});

test("guard: worktree target denied", () => {
  assert.equal(guard({ tool_name: "CallDynamicTool", tool_input: { toolName: "move_agent_to_root", arguments: { rootPath: "/r/.worktrees/exec-x" } } }), 2);
});

test("guard: windows worktree target denied", () => {
  assert.equal(guard({ tool_name: "move_agent_to_root", tool_input: { rootPath: "C:\\r\\.worktrees\\exec-x" } }), 2);
});

test("guard: repo target allowed", () => {
  assert.equal(guard({ tool_name: "move_agent_to_root", tool_input: '{"rootPath":"/r/app"}' }), 0);
});

test("guard: malformed stdin allowed", () => {
  assert.equal(guard("not json {{"), 0);
});
