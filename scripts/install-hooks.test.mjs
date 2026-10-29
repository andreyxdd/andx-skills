import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const CONTINUE = `node "${join(ROOT, "hooks", "andx-continue.mjs")}"`;
const GUARD = `node "${join(ROOT, "hooks", "deny-worktree-root.mjs")}"`;
const OTHER = { type: "command", command: "/usr/local/bin/notify" };

function install(mode, home) {
  const r = spawnSync(process.execPath, [join(here, "install-hooks.mjs"), mode, "--home", home], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

function seed() {
  const home = mkdtempSync(join(tmpdir(), "install-hooks-"));
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".cursor"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
    model: "opus",
    hooks: {
      Stop: [
        { hooks: [OTHER] },
        { hooks: [{ type: "command", command: "/old/andx-skills/hooks/andx_continue.rb", timeout: 10 }] },
      ],
      PreToolUse: [{ hooks: [OTHER] }],
    },
  }));
  writeFileSync(join(home, ".cursor", "hooks.json"), JSON.stringify({
    version: 1,
    hooks: {
      preToolUse: [{ command: "C:\\Users\\me\\andx-skills\\hooks\\deny_worktree_root.rb" }, { command: "mine.sh" }],
      afterFileEdit: [{ command: "fmt.sh" }],
    },
  }));
  return home;
}

test("install registers node hooks, drops legacy, keeps others, backs up, is idempotent", () => {
  const home = seed();
  try {
    install("install", home);
    const claude = read(join(home, ".claude", "settings.json"));
    assert.equal(claude.model, "opus");
    assert.deepEqual(claude.hooks.PreToolUse, [{ hooks: [OTHER] }]);
    assert.deepEqual(claude.hooks.Stop, [{ hooks: [OTHER] }, { hooks: [{ type: "command", command: CONTINUE, timeout: 10 }] }]);
    const cursor = read(join(home, ".cursor", "hooks.json"));
    assert.deepEqual(cursor, {
      version: 1,
      hooks: {
        preToolUse: [{ command: "mine.sh" }, { command: GUARD, timeout: 5 }],
        afterFileEdit: [{ command: "fmt.sh" }],
        beforeMCPExecution: [{ command: GUARD, timeout: 5 }],
      },
    });
    assert.ok(readdirSync(join(home, ".claude")).some((f) => f.startsWith("settings.json.bak-")));
    assert.ok(readdirSync(join(home, ".cursor")).some((f) => f.startsWith("hooks.json.bak-")));

    const before = [readFileSync(join(home, ".claude", "settings.json"), "utf8"), readFileSync(join(home, ".cursor", "hooks.json"), "utf8")];
    install("install", home);
    assert.deepEqual([readFileSync(join(home, ".claude", "settings.json"), "utf8"), readFileSync(join(home, ".cursor", "hooks.json"), "utf8")], before);

    install("uninstall", home);
    assert.deepEqual(read(join(home, ".claude", "settings.json")).hooks, { Stop: [{ hooks: [OTHER] }], PreToolUse: [{ hooks: [OTHER] }] });
    assert.deepEqual(read(join(home, ".cursor", "hooks.json")).hooks, { preToolUse: [{ command: "mine.sh" }], afterFileEdit: [{ command: "fmt.sh" }] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install into empty home creates both files", () => {
  const home = mkdtempSync(join(tmpdir(), "install-hooks-"));
  try {
    install("install", home);
    assert.equal(read(join(home, ".claude", "settings.json")).hooks.Stop[0].hooks[0].command, CONTINUE);
    assert.deepEqual(read(join(home, ".cursor", "hooks.json")).hooks.beforeMCPExecution, [{ command: GUARD, timeout: 5 }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("bad mode exits non-zero", () => {
  assert.notEqual(spawnSync(process.execPath, [join(here, "install-hooks.mjs"), "nope"]).status, 0);
});
