#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Validate SKILL.md files: YAML frontmatter, name == folder, description present,
relative links resolve (in-repo broken = error, external companion = warning).
  node check-skills.mjs [ROOT]                      default: this repo; exit 1 on errors
  node check-skills.mjs --budget                    catalog cost per harness (cursor:, claude:) across installed skill dirs
  node check-skills.mjs --prose [ROOT]              line counts, duplicated clauses, unresolved links (report only)
  node check-skills.mjs --tokens [ROOT] [--no-caps] read-chain tokens per entry skill/agent + catalog tokens per turn;
                                                    exit 1 if a chain is over its cap in ROOT/scripts/token-caps.json
                                                    or has none (--no-caps: print only)

Read chains (--tokens), tokens = floor(bytes / 4):
  entries  every */SKILL.md without disable-model-invocation: true, plus every andx-* skill except
           andx-orchestration (chain name drops "andx-"); every agents/*.md (same naming)
  refs     repo .md files a file links ([x](path)) or names by path (../x/y.md, ~/.cursor/skills/<x>/y.md
           mapped to ROOT/<x>/y.md); script paths (*.mjs, *.sh) and files outside ROOT are not refs
  hubs     non-entry files referenced by at least 3 entry skills
  direct   the entry's refs; another skill's SKILL.md counts only if it is a hub or its line says
           required/read/follow (otherwise it is a routing pointer)
  one hop  each direct file's refs that are hubs; nothing deeper is followed`;

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = (p) => path.join(os.homedir(), p);
const read = (p) => fs.readFileSync(p, "utf8");
const chars = (s) => [...s].length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const isDir = (p) => !!stat(p)?.isDirectory();

// Documented frontmatter keys, union of Cursor and Claude Code; anything else is a typo or drift.
const SKILL_KEYS = new Set(`name description paths globs disable-model-invocation icon color metadata
  allowed-tools argument-hint when_to_use model effort context agent hooks
  user-invocable version license arguments`.split(/\s+/));
const AGENT_KEYS = new Set(`name description model readonly is_background tools disallowedTools skills effort
  autoCompactWindow permissionMode mcpServers hooks memory isolation color maxTurns background`.split(/\s+/));

// Glob: "*" skips dot entries, each level sorted, symlinks followed.
function glob(base, pattern) {
  let paths = [base];
  for (const seg of pattern.split("/")) {
    const re = new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
    paths = paths.flatMap((p) => {
      if (!seg.includes("*")) return fs.existsSync(path.join(p, seg)) ? [path.join(p, seg)] : [];
      try { return fs.readdirSync(p).filter((e) => e[0] !== "." && re.test(e)).sort().map((e) => path.join(p, e)); } catch { return []; }
    });
  }
  return paths;
}

// "**/*.md": depth-first in sorted order, symlinked subdirectories not followed.
const mdTree = (dir) => fs.readdirSync(dir).filter((e) => e[0] !== ".").sort().flatMap((e) => {
  const p = path.join(dir, e);
  return fs.lstatSync(p).isDirectory() ? mdTree(p) : e.endsWith(".md") ? [p] : [];
});

// Top-level frontmatter keys: plain/quoted scalars, | and > blocks ("-" chomp), flow and block lists.
// Nested maps stay opaque ({}). Throws where YAML would on these shapes (e.g. "key: a: b") so bad
// frontmatter is reported, not guessed.
function yaml(src) {
  const L = src.split(/\r?\n/), out = {};
  const ind = (l) => l.search(/\S/);
  const skip = (l) => /^\s*(#.*)?$/.test(l);
  const fail = (m, i) => { throw new Error(`${m} at line ${i + 1}`); };
  const isSeq = (l) => /^\s*-(\s|$)/.test(l);
  const fold = (ls) => ls.reduce((s, l, k) => k === 0 ? l : s + (l === "" ? "\n" : ls[k - 1] === ""
    ? l : (/\s/.test(l[0] + ls[k - 1][0]) ? "\n" : " ") + l), "");

  function scalar(s, i) {
    let m;
    if ((m = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(s))) return JSON.parse(`"${m[1]}"`);
    if ((m = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(s))) return m[1].replaceAll("''", "'");
    if (/^["']/.test(s)) fail("unterminated quoted scalar", i);
    if ((m = /^\[(.*)\]\s*(#.*)?$/.exec(s))) return m[1].split(",").map((x) => x.trim()).filter(Boolean).map((x) => scalar(x, i));
    if (s[0] === "[") fail("unterminated flow sequence", i);
    s = s.replace(/\s+#.*$/, "");
    if (/:(\s|$)/.test(s)) fail("mapping values are not allowed in this context", i);
    return s === "true" ? true : s === "false" ? false : s === "" || s === "null" ? null : s;
  }

  for (let i = 0; i < L.length;) {
    if (skip(L[i])) { i++; continue; }
    const at = i, m = /^([^\s#'"[\]{}][^:]*?)\s*:(?:\s+(.*))?$/.exec(L[i++]);
    if (ind(L[at]) > 0) fail("bad indentation of a mapping entry", at);
    if (!m) fail("could not find expected ':'", at);
    const rest = (m[2] ?? "").replace(/^#.*/, "");
    const body = [];
    while (i < L.length && (ind(L[i]) !== 0 || (!rest && isSeq(L[i])))) body.push(L[i++]);
    const lines = body.filter((l) => !skip(l));
    const block = /^([|>])(-?)\s*(#.*)?$/.exec(rest);
    if (block) {
      while (body.length && !body.at(-1).trim()) body.pop();
      const k = ind(lines[0] ?? "");
      const ls = body.map((l) => (l.trim() ? l.slice(k) : ""));
      out[m[1]] = ls.length ? (block[1] === "|" ? ls.join("\n") : fold(ls)) + (block[2] ? "" : "\n") : "";
    } else if (rest || (lines.length && !isSeq(lines[0]) && !/^\s*[^\s#'"[\]{}][^:]*?:(\s|$)/.test(lines[0]))) {
      // Continuation lines fold to spaces, as YAML does for plain and quoted scalars.
      out[m[1]] = scalar([rest, ...lines.map((l) => l.trim())].filter(Boolean).join(" "), at);
    } else if (lines.length && isSeq(lines[0])) {
      const k = ind(lines[0]);
      out[m[1]] = lines.map((l) => (ind(l) === k && isSeq(l) ? scalar(l.trim().slice(1).trim(), at) : fail("bad indentation of a sequence entry", at)));
    } else {
      if (lines.some((l) => ind(l) < ind(lines[0]))) fail("bad indentation of a mapping entry", at);
      out[m[1]] = lines.length ? {} : null;
    }
  }
  return out;
}

function frontmatter(p) {
  const text = read(p);
  if (!text.startsWith("---")) return [null, "no frontmatter"];
  try { return [yaml(text.split(/^---\s*$/m)[1] ?? "") ?? {}, null]; } catch (e) { return [null, e.message]; }
}

const links = (p) => [...read(p).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:|#|<)/.test(l));

function resolve(link, dir, name) {
  const target = link.replace(/#.*$/, "");
  if (!target) return true;
  if (target.startsWith("~")) return fs.existsSync(path.join(os.homedir(), target.slice(1)));
  return [dir, home(path.join(".cursor/skills", name))].some((b) => fs.existsSync(path.resolve(b, target)));
}

function check(root) {
  const errors = [], warnings = [];
  const inRepo = fs.readdirSync(root).filter((d) => stat(path.join(root, d, "SKILL.md"))?.isFile());
  for (const p of glob(root, "*/SKILL.md")) {
    const dir = path.dirname(p), folder = path.basename(dir);
    const [fm, err] = frontmatter(p);
    if (err) { errors.push(`${folder}: invalid frontmatter (${err})`); continue; }
    if (fm.name !== folder) errors.push(`${folder}: name '${fm.name ?? ""}' != folder`);
    if (!String(fm.description ?? "").trim()) errors.push(`${folder}: empty description`);
    for (const k of Object.keys(fm)) if (!SKILL_KEYS.has(k)) errors.push(`${folder}: unknown frontmatter key '${k}'`);
    for (const md of glob(dir, "*.md")) {
      for (const l of links(md)) {
        if (resolve(l, dir, folder)) continue;
        const local = !(l.startsWith("../") || l.startsWith("~")) || inRepo.includes(l.replace(/^\.\.\//, "").split("/")[0]);
        (local ? errors : warnings).push(`${folder}/${path.basename(md)}: unresolved link ${l}`);
      }
    }
  }
  for (const p of glob(root, "agents/*.md")) {
    const rel = `agents/${path.basename(p)}`;
    const [fm, err] = frontmatter(p);
    if (err) { errors.push(`${rel}: invalid frontmatter (${err})`); continue; }
    for (const k of Object.keys(fm)) if (!AGENT_KEYS.has(k)) errors.push(`${rel}: unknown frontmatter key '${k}'`);
  }
  return [errors, warnings];
}

const HARNESS_DIRS = {
  cursor: [".cursor/skills", ".agents/skills", ".claude/skills", ".codex/skills", ".cursor/skills-cursor"],
  claude: [".claude/skills"],
};

function visibleSkills(harness = "cursor") {
  let enabled = {};
  try { enabled = JSON.parse(read(home(".claude/settings.json"))).enabledPlugins ?? {}; } catch {}
  const mtime = (p) => fs.statSync(p).mtimeMs;
  const plugins = Object.entries(enabled).filter(([, v]) => v !== false && v !== null).map(([k]) => {
    const [plugin, market = ""] = k.split("@");
    return glob(home(path.join(".claude/plugins/cache", market, plugin)), "*/skills").reduce((a, p) => (!a || mtime(p) > mtime(a) ? p : a), null);
  }).filter(Boolean);
  const seen = new Map();
  for (const d of [...HARNESS_DIRS[harness].map(home), ...plugins]) {
    for (const p of glob(d, "*/SKILL.md")) {
      const [fm] = frontmatter(p);
      if (!fm || fm["disable-model-invocation"] === true) continue;
      const n = String(fm.name ?? path.basename(path.dirname(p)));
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n).push([p, String(fm.description ?? "")]);
    }
  }
  return seen;
}

// Same-name skills dedupe across skill dirs, but each plugin-cache copy is listed alongside them.
function shown(entries) {
  const cached = ([p]) => /[\\/]plugins[\\/]cache[\\/]/.test(p);
  return [...entries.filter((e) => !cached(e)).slice(0, 1), ...entries.filter(cached)];
}

const catalogCopies = (seen) => [...seen].flatMap(([n, v]) => shown(v).map(([, d]) => [n, d]));
const catalogTokens = (seen) => Math.floor(sum(catalogCopies(seen).map(([n, d]) => chars(n) + chars(d) + 20)) / 4);

function budget() {
  let cursor;
  for (const h of Object.keys(HARNESS_DIRS)) {
    const seen = visibleSkills(h), rows = catalogCopies(seen);
    const dups = [...seen].filter(([, v]) => shown(v).length > 1).map(([n]) => n).sort();
    console.log(`${h}: visible=${rows.length} description_chars=${sum(rows.map(([, d]) => chars(d)))} ` +
      `tokens_per_turn=${catalogTokens(seen)} duplicates=${dups.join(",")}`);
    cursor ??= rows;
  }
  const long = cursor.filter(([, d]) => chars(d) > 250);
  const late = [...new Set(cursor.filter(([n, d]) => n.startsWith("andx-") && ![...d].slice(0, 90).join("").includes(`/${n}`)).map(([n]) => n))];
  console.log(`cursor descriptions > 250 chars: ${long.length}`);
  long.sort((a, b) => chars(b[1]) - chars(a[1])).slice(0, 15).forEach(([n, d]) => console.log(`  ${chars(d)}\t${n}`));
  console.log(`andx descriptions without /name in first 90 chars: ${late.sort().join(" ")}`);
  console.log(`visible andx skills: ${cursor.filter(([n]) => n.startsWith("andx-")).length}`);
  const cp = new Map();
  for (const p of glob(home(".cursor/plugins/cache"), "*/*/*/skills*/*/SKILL.md")) {
    const k = p.split(/[\\/]plugins[\\/]cache[\\/]/)[1].split(/[\\/]/)[1];
    cp.set(k, (cp.get(k) ?? 0) + 1);
  }
  console.log("cursor plugin cache skills (enable state lives in Cursor Settings > Plugins, not counted above): " +
    [...cp].map(([k, v]) => `${k}=${v}`).join(" "));
}

const relTo = (root, p) => path.relative(root, p).split(path.sep).join("/");

// [repo-relative .md, line] for each file a file links or names by path.
function refs(root, file) {
  const out = [];
  for (const line of read(file).split("\n")) {
    const found = [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
      .concat(line.match(/(?:\.\.\/|~\/\.cursor\/skills\/)[^\s`)'"]+/g) ?? []);
    for (const ref of found) {
      const t = ref.replace(/#.*$/, "").replace(/[.,;:]+$/, "");
      if (!t.endsWith(".md") || /^[a-z]+:/.test(t) || (t.startsWith("~") && !t.startsWith("~/.cursor/skills/"))) continue;
      const abs = t.startsWith("~") ? path.join(root, t.slice("~/.cursor/skills/".length)) : path.resolve(path.dirname(file), t);
      const rel = relTo(root, abs);
      if (!rel.startsWith("..") && stat(abs)?.isFile()) out.push([rel, line]);
    }
  }
  return out;
}

// Another skill's SKILL.md that is not a hub is a routing pointer unless its line says to read it.
const reads = (root, file, hubs) => new Set(refs(root, file).filter(([rel, line]) =>
  path.basename(rel) !== "SKILL.md" || hubs.has(rel) || /\b(required|read|follow)/i.test(line)).map(([rel]) => rel));

// Entry skills: model-invocable SKILL.md plus every andx-* composer except orchestration; then every agent.
function chains(root) {
  const skills = glob(root, "*/SKILL.md").filter((p) => {
    const d = path.basename(path.dirname(p));
    return d !== "andx-orchestration" && (d.startsWith("andx-") || frontmatter(p)[0]?.["disable-model-invocation"] !== true);
  });
  const entries = new Set(skills.map((p) => relTo(root, p))), linkedBy = new Map();
  for (const p of skills) for (const rel of new Set(refs(root, p).map(([r]) => r))) linkedBy.set(rel, (linkedBy.get(rel) ?? 0) + 1);
  const hubs = new Set([...linkedBy].filter(([rel, n]) => n >= 3 && !entries.has(rel)).map(([rel]) => rel));
  return [...skills, ...glob(root, "agents/*.md")].map((p) => {
    const entry = relTo(root, p), direct = reads(root, p, hubs);
    const files = new Set([entry, ...direct]);
    for (const f of direct) for (const h of reads(root, path.join(root, f), hubs)) if (hubs.has(h)) files.add(h);
    const name = (entry.startsWith("agents/") ? path.basename(entry, ".md") : path.dirname(entry)).replace(/^andx-/, "");
    return [name, [...files]];
  });
}

function tokens(root, noCaps) {
  const caps = noCaps ? null : JSON.parse(read(path.join(root, "scripts", "token-caps.json")));
  let over = 0;
  for (const [name, files] of chains(root)) {
    const t = Math.floor(sum(files.map((f) => fs.statSync(path.join(root, f)).size)) / 4);
    console.log(`  ${t}\t${name}`);
    if (caps && !(t <= caps[name])) {
      console.log(`over cap: ${name} ${t} > ${caps[name] ?? "none"}`);
      over = 1;
    }
  }
  console.log(`catalog tokens per turn (visible skills): ${catalogTokens(visibleSkills())}`);
  process.exitCode = over;
}

// Report only: SKILL.md line counts, clauses repeated across files, unresolved links.
function prose(root) {
  const lines = (p) => { const t = read(p); return t.split("\n").length - (t === "" || t.endsWith("\n") ? 1 : 0); };
  const mds = glob(root, "*").filter(isDir).flatMap(mdTree).filter((p) => !/[\\/](references|templates)[\\/]/.test(p));
  glob(root, "*/SKILL.md").map((p) => [lines(p), path.basename(path.dirname(p))])
    .sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .forEach(([n, s]) => console.log(`  ${n}\t${s}`));
  console.log(`total lines (skill docs, excl. vendored/templates): ${sum(mds.map(lines))}`);
  const clauses = new Map();
  for (const p of mds) {
    const rel = path.relative(root, p).split(path.sep).join("/");
    const cs = new Set(read(p).split(/(?<=[.!?])\s+|\n/)
      .map((c) => c.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/ +/g, " ").trim())
      .filter((c) => c.split(" ").length >= 8));
    for (const c of cs) clauses.set(c, [...(clauses.get(c) ?? []), rel]);
  }
  const dup = [...clauses].filter(([, f]) => f.length > 1);
  console.log(`duplicated clauses (>= 8 words, in >1 file): ${dup.length}`);
  dup.sort((a, b) => b[1].length - a[1].length).slice(0, 10)
    .forEach(([c, f]) => console.log(`  ${f.length}x ${c.slice(0, 70)} (${f.slice(0, 3).join(", ")})`));
  const [errors, warnings] = check(root);
  console.log(`unresolved links: ${[...errors, ...warnings].filter((m) => m.includes("unresolved link")).length}`);
}

const argv = process.argv.slice(2), noCaps = argv.includes("--no-caps");
const [mode, arg] = argv.filter((a) => a !== "--no-caps");
if (mode === "--help" || mode === "-h") console.log(HELP);
else if (mode === "--tokens") tokens(path.resolve(arg ?? REPO), noCaps);
else if (mode === "--prose") prose(path.resolve(arg ?? REPO));
else if (mode === "--budget") budget();
else {
  const [errors, warnings] = check(path.resolve(mode ?? REPO));
  warnings.forEach((w) => console.log(`warn: ${w}`));
  errors.forEach((e) => console.log(`error: ${e}`));
  console.log(`check-skills: ${errors.length} errors, ${warnings.length} warnings`);
  process.exitCode = errors.length ? 1 : 0;
}
