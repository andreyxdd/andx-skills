import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCAFFOLD = join(dirname(fileURLToPath(import.meta.url)), "scaffold.mjs");
const scaffold = (...a) => spawnSync(process.execPath, [SCAFFOLD, ...a], { encoding: "utf8" });
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
const has = (p, s) => fs.readFileSync(p, "utf8").includes(s);

const PRESET = {
  app: { files: ["pipeline/01-discover/CONTEXT.md", "pipeline/04-verify/CONTEXT.md", "pipeline/01-discover/output/.gitkeep", "AGENTS.md", "knowledge/doc-sync-map.md"],
    dirs: ["knowledge/apis", "pipeline/01-discover/output"] },
  data: { files: ["pipeline/01-catalog/CONTEXT.md"], dirs: ["knowledge/datasets"] },
  content: { files: ["pipeline/01-research/CONTEXT.md"], dirs: ["knowledge/voice"] },
};

for (const [preset, { files, dirs }] of Object.entries(PRESET)) {
  test(`${preset} preset scaffolds a fresh repo`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), `scaffold-${preset}-`));
    try {
      const r = scaffold(preset, dir);
      assert.equal(r.status, 0, r.stderr);
      for (const f of ["IDENTITY.md", "ROUTING.md", "knowledge/index.md", "knowledge/domain/glossary.md", ...files]) assert.ok(isFile(join(dir, f)), f);
      for (const d of [".cursor/plans", ...dirs]) assert.ok(isDir(join(dir, d)), d);
      assert.ok(has(join(dir, "knowledge/domain/glossary.md"), "type: Glossary"));
      const gi = join(dir, ".gitignore");
      for (const line of ["pipeline/*/output/*", "!pipeline/*/output/.gitkeep", ".cursor/plans/"]) assert.ok(has(gi, line), line);
      assert.match(r.stdout, new RegExp(`^Scaffold complete: preset=${preset} root=`, "m"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("brownfield keeps existing files and appends gitignore lines once", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "scaffold-brown-"));
  try {
    fs.writeFileSync(join(dir, "README.md"), "ORIGINAL README\n");
    fs.writeFileSync(join(dir, "IDENTITY.md"), "MINE");
    fs.writeFileSync(join(dir, ".gitignore"), "node_modules/");
    const r = scaffold("app", dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(has(join(dir, "README.md"), "ORIGINAL README"));
    assert.equal(fs.readFileSync(join(dir, "IDENTITY.md"), "utf8"), "MINE");
    assert.match(r.stdout, /^skip \(exists\): .*IDENTITY\.md$/m);
    assert.ok(isFile(join(dir, "ROUTING.md")));
    const want = "node_modules/\npipeline/*/output/*\n!pipeline/*/output/.gitkeep\n.cursor/plans/\n";
    assert.equal(fs.readFileSync(join(dir, ".gitignore"), "utf8"), want);
    assert.equal(scaffold("app", dir).status, 0);
    assert.equal(fs.readFileSync(join(dir, ".gitignore"), "utf8"), want);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bad arguments exit 1", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "scaffold-bad-"));
  try {
    assert.equal(scaffold("app").status, 1);
    assert.match(scaffold("nope", dir).stderr, /Unknown preset: nope/);
    assert.equal(scaffold("..", dir).status, 1);
    assert.match(scaffold("app", join(dir, "missing")).stderr, /Repo root does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
