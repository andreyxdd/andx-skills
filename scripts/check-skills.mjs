#!/usr/bin/env node
// Validate SKILL.md files: YAML frontmatter, name == folder, description present,
// relative links resolve (in-repo broken = error, external companion = warning).
//   node check-skills.mjs [ROOT]            # default: this repo; exit 1 on errors
//   node check-skills.mjs --budget          # catalog cost per harness (cursor:, claude:) across installed skill dirs
//   node check-skills.mjs --prose [ROOT]    # line counts, duplicated clauses, unresolved links (report only)
//   node check-skills.mjs --tokens [ROOT]   # read-chain tokens per composer/agent + catalog tokens per turn
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Ruby-style glob: "*" skips dot entries, each level sorted, symlinks followed.
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

// YAML subset for frontmatter: block maps/lists, flow lists, plain/quoted scalars, | and > blocks.
// Throws where YAML would (e.g. "key: a: b") so bad frontmatter is reported, not guessed.
function yaml(src) {
  const L = src.replace(/\r?\n$/, "").split(/\r?\n/);
  let i = 0;
  const ind = (l) => l.search(/\S/);
  const blank = (l) => /^\s*$/.test(l);
  const isSeq = (l) => /^\s*-(\s|$)/.test(l);
  const skip = () => { while (i < L.length && /^\s*(#.*)?$/.test(L[i])) i++; };
  const fail = (m) => { throw new Error(`${m} at line ${i + 1}`); };
  const fold = (ls, keepIndent) => ls.reduce((s, l, k) => k === 0 ? l : s + (l === "" ? "\n" : ls[k - 1] === ""
    ? l : (keepIndent && /\s/.test(l[0] + ls[k - 1][0]) ? "\n" : " ") + l), "");
  const more = (n) => { const a = []; while (i < L.length && (blank(L[i]) || ind(L[i]) > n)) a.push(L[i++]); return a; };
  const plain = (s) => /^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(s) ? true
    : /^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(s) ? false : /^(~|null|Null|NULL|)$/.test(s) ? null : s;

  function scalar(rest, n) {
    const block = /^([|>])([+-]?)\s*(#.*)?$/.exec(rest);
    if (block) {
      const raw = more(n);
      const k = ind(raw.find((l) => !blank(l)) ?? "");
      const ls = raw.map((l) => (blank(l) ? "" : l.slice(k)));
      let end = ls.length;
      while (end && ls[end - 1] === "") end--;
      if (!end) return "";
      const s = block[1] === "|" ? ls.slice(0, end).join("\n") : fold(ls.slice(0, end), true);
      return s + (block[2] === "-" ? "" : "\n".repeat(block[2] === "+" ? ls.length - end + 1 : 1));
    }
    if (rest[0] === '"' || rest[0] === "'") {
      const re = rest[0] === '"' ? /^"((?:[^"\\]|\\[\s\S])*)"(.*)$/ : /^'((?:[^']|'')*)'(?!')(.*)$/;
      let text = rest, m;
      while (!(m = re.exec(text))) { if (i >= L.length) fail("unterminated quoted scalar"); text += "\n" + L[i++]; }
      if (!/^\s*(#.*)?$/.test(m[2]) || /^#/.test(m[2])) fail("did not find expected key");
      const ls = m[1].split("\n").map((l, k, a) => (a.length === 1 ? l : k === 0 ? l.trimEnd() : k === a.length - 1 ? l.trimStart() : l.trim()));
      const s = fold(ls, false);
      if (rest[0] === "'") return s.replaceAll("''", "'");
      const esc = { n: "\n", t: "\t", r: "\r", 0: "\0", " ": " ", "/": "/", '"': '"', "\\": "\\", "\t": "\t" };
      return s.replace(/\\(x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|.)/g, (_, e) =>
        e.length > 1 ? String.fromCodePoint(parseInt(e.slice(1), 16)) : esc[e] ?? fail("found unknown escape character"));
    }
    if (rest[0] === "[") {
      let text = rest;
      while (!text.includes("]")) { if (i >= L.length) fail("unterminated flow sequence"); text += " " + L[i++].trim(); }
      return text.slice(1, text.lastIndexOf("]")).split(",").map((s) => s.trim()).filter(Boolean)
        .map((s) => (/^["']/.test(s) ? s.slice(1, -1) : plain(s)));
    }
    if (/^[@`%]/.test(rest)) fail("found character that cannot start any token");
    const ls = [];
    for (const l of [rest, ...more(n)].map((x) => x.trim())) {
      if (l[0] === "#") break;
      const s = l.replace(/\s+#.*$/, "");
      if (/:(\s|$)/.test(s)) fail("mapping values are not allowed in this context");
      ls.push(s);
      if (s !== l) break;
    }
    while (ls.at(-1) === "") ls.pop();
    return ls.length > 1 ? fold(ls, false) : plain(ls[0] ?? "");
  }

  function node(min) {
    skip();
    if (i >= L.length || ind(L[i]) < min) return null;
    const n = ind(L[i]);
    if (isSeq(L[i])) {
      const out = [];
      while ((skip(), i < L.length && ind(L[i]) === n && isSeq(L[i]))) {
        const rest = L[i].slice(n + 1).trimStart();
        if (/^[^\s#'"[{][^:]*:(\s|$)/.test(rest)) {
          L[i] = " ".repeat(L[i].length - rest.length) + rest;
          out.push(node(n + 1));
        } else {
          i++;
          out.push(rest && rest[0] !== "#" ? scalar(rest, n) : node(n + 1));
        }
      }
      return out;
    }
    if (!/^[^\s#'"[\]{}][^:]*?:(\s|$)/.test(L[i].slice(n))) return scalar(L[i++].slice(n), n - 1);
    const out = {};
    while ((skip(), i < L.length && ind(L[i]) >= n)) {
      if (ind(L[i]) > n) fail("bad indentation of a mapping entry");
      const m = /^([^\s#'"[\]{}][^:]*?)\s*:(?:\s+(.*))?$/.exec(L[i].slice(n));
      if (!m) fail("could not find expected ':'");
      i++;
      const rest = m[2] ?? "";
      out[m[1]] = rest && rest[0] !== "#" ? scalar(rest, n)
        : (skip(), i < L.length && ind(L[i]) === n && isSeq(L[i])) ? node(n) : node(n + 1);
    }
    return out;
  }

  const doc = node(0);
  skip();
  if (i < L.length) fail("did not find expected key");
  return doc;
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

// Chains are hand-maintained; derive them from links if they drift from what agents actually read.
const CHAINS = {
  execute: ["andx-execute/SKILL.md", "andx-orchestration/SKILL.md", "andx-orchestration/HARNESS.md", "andx-plan/PARSE.md"],
  "execute-and-review": ["andx-execute-and-review/SKILL.md", "andx-execute/SKILL.md", "andx-orchestration/SKILL.md",
    "andx-orchestration/HARNESS.md", "andx-orchestration/SKILL-MAP.md", "andx-plan/PARSE.md",
    "andx-mr-review/FINDINGS-SCHEMA.md", "andx-security-review/VERIFIER.md"],
  worker: ["agents/andx-worker.md", "andx-execute/WORKER.md"],
  analyst: ["agents/andx-analyst.md", "andx-debug-and-fix/SKILL.md"],
  plan: ["andx-plan/SKILL.md", "andx-plan/PLAN-FORMAT.md", "andx-plan/PARSE.md", "andx-orchestration/SKILL-MAP.md"],
  "mr-review": ["andx-mr-review/SKILL.md", "andx-mr-review/HOSTS.md", "andx-mr-review/FINDINGS-SCHEMA.md",
    "andx-mr-review/COMMENT-STYLE.md", "andx-mr-review/REPORT-FORMAT.md", "andx-mr-review/EXAMPLES.md"],
  "mr-babysit": ["andx-mr-babysit/SKILL.md", "andx-mr-review/HOSTS.md"],
};

function tokens(root) {
  for (const [name, files] of Object.entries(CHAINS)) {
    console.log(`  ${Math.floor(sum(files.map((f) => fs.statSync(path.join(root, f)).size)) / 4)}\t${name}`);
  }
  console.log(`catalog tokens per turn (visible skills): ${catalogTokens(visibleSkills())}`);
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

const [mode, arg] = process.argv.slice(2);
if (mode === "--tokens") tokens(path.resolve(arg ?? REPO));
else if (mode === "--prose") prose(path.resolve(arg ?? REPO));
else if (mode === "--budget") budget();
else {
  const [errors, warnings] = check(path.resolve(mode ?? REPO));
  warnings.forEach((w) => console.log(`warn: ${w}`));
  errors.forEach((e) => console.log(`error: ${e}`));
  console.log(`check-skills: ${errors.length} errors, ${warnings.length} warnings`);
  process.exitCode = errors.length ? 1 : 0;
}
