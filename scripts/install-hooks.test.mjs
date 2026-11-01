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
const PRIMARY = `node "${join(ROOT, "hooks", "guard-primary.mjs")}"`;
const CLAUDE_PRIMARY = { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: PRIMARY, timeout: 5 }] };
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
      PreToolUse: [{ hooks: [OTHER] }, { matcher: "Edit", hooks: [{ type: "command", command: "node /old/andx-skills/hooks/guard-primary.mjs" }] }],
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
    assert.deepEqual(claude.hooks.PreToolUse, [{ hooks: [OTHER] }, CLAUDE_PRIMARY]);
    assert.deepEqual(claude.hooks.Stop, [{ hooks: [OTHER] }, { hooks: [{ type: "command", command: CONTINUE, timeout: 10 }] }]);
    const cursor = read(join(home, ".cursor", "hooks.json"));
    assert.deepEqual(cursor, {
      version: 1,
      hooks: {
        preToolUse: [{ command: "mine.sh" }, { command: GUARD, timeout: 5 }, { command: PRIMARY, timeout: 5 }],
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
    assert.deepEqual(read(join(home, ".claude", "settings.json")).hooks.PreToolUse, [CLAUDE_PRIMARY]);
    assert.deepEqual(read(join(home, ".cursor", "hooks.json")).hooks.beforeMCPExecution, [{ command: GUARD, timeout: 5 }]);
    assert.deepEqual(read(join(home, ".cursor", "hooks.json")).hooks.preToolUse, [{ command: GUARD, timeout: 5 }, { command: PRIMARY, timeout: 5 }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex and Kimi hooks only when their home exists; idempotent; uninstall keeps the rest", () => {
  const home = mkdtempSync(join(tmpdir(), "install-hooks-"));
  try {
    install("install", home);
    assert.deepEqual(readdirSync(home).sort(), [".claude", ".cursor"]);

    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".kimi-code"));
    const toml = join(home, ".kimi-code", "config.toml");
    writeFileSync(toml, 'default_model = "k2"\n\n[[hooks]]\nevent = "Stop"\ncommand = "mine.sh"\n');
    install("install", home);
    const codex = read(join(home, ".codex", "hooks.json"));
    assert.deepEqual(codex.hooks.PreToolUse, [{ matcher: "apply_patch|Edit|Write", hooks: [{ type: "command", command: PRIMARY, timeout: 5 }] }]);
    assert.equal(codex.hooks.Stop[0].hooks[0].command, CONTINUE);
    const text = readFileSync(toml, "utf8");
    assert.ok(text.startsWith('default_model = "k2"\n\n[[hooks]]\nevent = "Stop"\ncommand = "mine.sh"\n\n# >>> andx hooks'), text);
    assert.ok(text.includes(`command = ${JSON.stringify(`${CONTINUE} --exit2`)}\ntimeout = 10\n`), text);
    assert.ok(text.includes(`[[hooks]]\nevent = "PreToolUse"\nmatcher = "Write|Edit"\ncommand = ${JSON.stringify(PRIMARY)}\ntimeout = 5\n# <<< andx hooks\n`), text);
    for (const line of text.split("\n").filter((l) => / = /.test(l))) assert.match(line, /^(default_model|event|matcher|command|timeout) = /, line);
    install("install", home);
    assert.equal(readFileSync(toml, "utf8"), text);

    install("uninstall", home);
    assert.equal(readFileSync(toml, "utf8"), 'default_model = "k2"\n\n[[hooks]]\nevent = "Stop"\ncommand = "mine.sh"\n');
    assert.deepEqual(read(join(home, ".codex", "hooks.json")).hooks, {});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("bad mode exits non-zero", () => {
  assert.notEqual(spawnSync(process.execPath, [join(here, "install-hooks.mjs"), "nope"]).status, 0);
});
