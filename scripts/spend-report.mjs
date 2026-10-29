#!/usr/bin/env node
// Token spend per andx run from Claude Code transcripts (~/.claude/projects).
// A run = parent session jsonl + its subagent jsonl files (sibling agent-*.jsonl with the
// same sessionId, or <session>/subagents/*.jsonl), counted only when the parent invokes an
// andx- skill (slash command, slash-prefixed skill name in user text, or Skill tool). The skill catalog
// names every andx skill in every session, so a bare mention does not count.
// Input = uncached + cache write + cache read.
//   node spend-report.mjs <session.jsonl|dir>   # per-run report
//   node spend-report.mjs --summary <dir>       # medians + totals; no project names or session ids
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Unreadable files are counted, never named: paths carry project names.
const skipped = new Set();

// Whole-file reads; a transcript near V8's ~500 MB string limit would need a streaming reader.
function lines(p) {
  try {
    return fs.readFileSync(p, "utf8").split(/(?<=\n)/);
  } catch (e) {
    if (!e.code) throw e;
    skipped.add(p);
    return [];
  }
}

const parse = (l) => { try { const j = JSON.parse(l); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } };
const hashes = (c) => (Array.isArray(c) ? c.filter((b) => b && typeof b === "object" && !Array.isArray(b)) : []);
const int = (v) => Number.parseInt(v ?? 0, 10) || 0;
const chars = (s) => s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
const sorted = (dir, keep) => { try { return fs.readdirSync(dir).filter((e) => e[0] !== "." && keep(e)).sort().map((e) => path.join(dir, e)); } catch { return []; } };

// First andx skill the parent invokes, or null.
function firstAndxSkill(p) {
  for (const l of lines(p)) {
    if (!l.includes("andx-")) continue;
    const j = parse(l);
    const c = j?.message?.content;
    const blocks = hashes(c);
    if (j?.type === "user") {
      for (const t of typeof c === "string" ? [c] : blocks.map((b) => String(b.text ?? ""))) {
        const m = /(?:^|[ \t\r\n\f\v>])\/(andx-[a-z][a-z-]*)/.exec(t);
        if (m) return m[1];
      }
    } else if (j?.type === "assistant") {
      for (const b of blocks) {
        const skill = String(b.input?.skill ?? "");
        if (b.type === "tool_use" && b.name === "Skill" && skill.startsWith("andx-")) return skill;
      }
    }
  }
  return null;
}

// Assistant lines repeat the same usage once per content block; count each message id once.
function usageOf(files) {
  const s = { requests: 0, input: 0, output: 0, peak: 0, images: 0, tools: new Map() };
  const seen = new Set(), names = new Map();
  for (const f of files) {
    for (const l of lines(f)) {
      if (l.startsWith('{"type":"api-')) continue;
      if (!l.includes('"usage"') && !l.includes('"tool_result"')) continue;
      const j = parse(l), m = j?.message;
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const blocks = hashes(m.content);
      if (j.type === "assistant") {
        for (const b of blocks) if (b.type === "tool_use") names.set(b.id, b.name);
        const u = m.usage, key = m.id ?? j.uuid;
        if (u == null || seen.has(key)) continue;
        seen.add(key);
        const ctx = int(u.input_tokens) + int(u.cache_creation_input_tokens) + int(u.cache_read_input_tokens);
        s.requests += 1;
        s.input += ctx;
        s.output += int(u.output_tokens);
        if (ctx > s.peak) s.peak = ctx;
      } else if (j.type === "user") {
        for (const b of blocks.filter((x) => x.type === "tool_result")) {
          const parts = Array.isArray(b.content) ? b.content : [{ text: String(b.content ?? "") }];
          if (parts.some((x) => x?.type === "image")) s.images += 1;
          const name = names.get(b.tool_use_id) ?? "?";
          s.tools.set(name, (s.tools.get(name) ?? 0) + parts.reduce((a, x) => a + chars(String(x?.text ?? "")), 0));
        }
      }
    }
  }
  return s;
}

const siblings = new Map();
function siblingAgents(dir) {
  if (!siblings.has(dir)) {
    const groups = new Map();
    for (const f of sorted(dir, (e) => e.startsWith("agent-") && e.endsWith(".jsonl"))) {
      let id = null;
      for (const l of lines(f)) if ((id = /"sessionId":"([^"]+)"/.exec(l)?.[1] ?? null)) break;
      groups.set(id, [...(groups.get(id) ?? []), f]);
    }
    siblings.set(dir, groups);
  }
  return siblings.get(dir);
}

function runOf(p, skill) {
  const id = path.basename(p, ".jsonl"), dir = path.dirname(p);
  const subs = [...sorted(path.join(dir, id, "subagents"), (e) => e.endsWith(".jsonl")), ...(siblingAgents(dir).get(id) ?? [])];
  return { id, skill, parent: usageOf([p]), sub: usageOf(subs) };
}

// "**/*.jsonl": sorted, dot entries skipped, symlinked directories matched but not entered.
const walk = (dir) => sorted(dir, () => true).flatMap((p) =>
  [...(p.endsWith(".jsonl") ? [p] : []), ...(fs.lstatSync(p).isDirectory() ? walk(p) : [])]);

function runs(arg) {
  const sessions = fs.statSync(arg, { throwIfNoEntry: false })?.isFile() ? [arg]
    : walk(arg).filter((f) => !path.basename(f).startsWith("agent-") && !/[\\/]subagents[\\/]/.test(f)).sort();
  return sessions.map((f) => { const skill = firstAndxSkill(f); return skill && runOf(f, skill); }).filter(Boolean);
}

function metrics({ parent: p, sub: s }) {
  return {
    input_total: p.input + s.input, input_parent: p.input, input_subagent: s.input,
    requests_parent: p.requests, requests_subagent: s.requests,
    output: p.output + s.output, output_parent: p.output, output_subagent: s.output,
    peak_context_parent: p.peak, peak_context_subagent: s.peak,
    image_results: p.images + s.images,
  };
}

function printRun(r) {
  const m = metrics(r);
  const tools = new Map(r.parent.tools);
  for (const [k, v] of r.sub.tools) tools.set(k, (tools.get(k) ?? 0) + v);
  const top = [...tools].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`run ${r.id}`);
  console.log(`  requests parent=${m.requests_parent} subagent=${m.requests_subagent}`);
  console.log(`  input parent=${m.input_parent} subagent=${m.input_subagent} total=${m.input_total}`);
  console.log(`  output parent=${m.output_parent} subagent=${m.output_subagent}`);
  console.log(`  peak_context parent=${m.peak_context_parent} subagent=${m.peak_context_subagent}`);
  console.log(`  image_results ${m.image_results}`);
  console.log(`  top_tool_output ${top.map(([n, c]) => `${n}=${Math.floor(c / 4)}`).join(" ")}`);
}

function median(xs) {
  const v = [...xs].sort((a, b) => a - b), h = v.length >> 1;
  const m = v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  return Number.isInteger(m) ? m : Math.round(m * 10) / 10;
}

function summary(all) {
  const rows = all.map(metrics);
  console.log(`runs ${rows.length}`);
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  console.log(`median ${keys.map((k) => `${k}=${median(rows.map((r) => r[k]))}`).join(" ")}`);
  console.log(`total ${keys.map((k) => `${k}=${rows.reduce((a, r) => a + r[k], 0)}`).join(" ")}`);
  const bySkill = new Map();
  for (const r of all) bySkill.set(r.skill, [...(bySkill.get(r.skill) ?? []), metrics(r)]);
  for (const [skill, ms] of [...bySkill].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    console.log(`${skill} runs=${ms.length} median input_total=${median(ms.map((m) => m.input_total))} ` +
      `output=${median(ms.map((m) => m.output))}`);
  }
}

const abs = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
const [first, second] = process.argv.slice(2);
let report;
if (first === "--summary" && second) {
  const all = runs(abs(second));
  report = () => summary(all);
} else if (first && fs.existsSync(first)) {
  const all = runs(abs(first));
  report = () => all.forEach(printRun);
} else {
  console.error("usage: spend-report.mjs <session.jsonl|dir> | --summary <dir>");
  process.exit(1);
}
if (skipped.size) console.error(`skipped ${skipped.size} unreadable files`);
report();
