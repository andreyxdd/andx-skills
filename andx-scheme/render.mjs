#!/usr/bin/env node
// Render a scheme spec (JSON) into one self-contained HTML file.
import fs from "node:fs";
import path from "node:path";

const HELP = `Usage: node render.mjs <spec.scheme.json> [out.html]
  Writes <spec>.html next to the spec unless out.html is given. Exits 1 and lists every problem
  when the spec is incomplete; nothing is written then.

Spec fields (see example.scheme.json):
  title, question            required strings
  refs[]                     "repo ref sha" strings: what the trace was read at
  phrases{}                  key -> sentence; write "@key" anywhere a text goes to reuse it
  terms[]                    { term, means }: one plain line per word a reader may not know
  route[]                    { name, does, src|status }: the hops, the same for every variant
  requests[], responses[]    { title, line?, tag?, tone?, body, src|status }
  notes[]                    plain strings under the examples
  callers[]                  { id, name }: adds a "Who asks" switch. An item with for: "<id>" (route hop,
                             request, response, note { text, for }, tag, fact) shows only for that caller;
                             a column or cell written { by: { <id>: ... } } has one version per caller
  links{}                    name -> URL (a ticket id, "repo !12"); every mention of a name on the page
                             becomes a link to it
  ticketPattern              regular expression source, e.g. "(SHOP|OPS)-\\d+": every match in the page text
                             must be a links{} name, or the render fails naming the id
  topics[]                   { title, for?, facts[] }: a short bulleted block in the top section, for what
                             holds in every variant
  cases[]                    { id, text }: named test inputs, tagged on the rows they hit; a case chip
                             shows its text on hover or focus
  variants[]                 { title, status?, tags[]?, facts[], view?, ... }
    status "proposed"        the whole variant is a proposal: one chip by its title, and its items need
                             no src or status of their own
    facts[]                  { text, src|status }: about six a variant, about ten words each; the
                             renderer prints a note when a block goes over
    more                     { title?, facts[] }: bullets folded under a toggle (reasons, side notes)
    view "rows" (default)    columns[] and rows[]: { cells[], cases[]?, examples[]?, src|status }
                             a cell is a string or { text, tone }
    view "sequence"          actors[] and steps[]: { from, to, text, tone?, cases[]?, examples[]?, src|status }
    rows[] group             { group: "title", open? } in place of a row starts a named block: the rows
                             after it fold under the title (open: true shows them at first); a block
                             with no rows is a plain line. Every rows variant carries the same group
                             titles in the same order
    examples[]               request/response cards under one row or step, same shape as requests[];
                             folded behind an "Examples (n)" toggle so the rows stay readable
  tone                       ok | bad | warn | info
  evidence                   every route hop, request, response, fact, row and step carries
                             src ("path:line") or status ("proposed" | "example")
  link                       optional http(s) URL next to src or status: a permalink to the code line,
                             the MR or the ticket; the Sources list shows it as a link
  seen                       optional string next to src, on a fact, row, step or example card: where and
                             when this was observed on a running system ("staging 2026-01-10, direct
                             request"); shown as a "seen" chip and in the Sources list
  reading notes              printed for a long fact block, a row or step with no examples[], and a src
                             with no link; the page is still written`;

const [specPath, outArg] = process.argv.slice(2);
if (!specPath || specPath === "--help" || specPath === "-h") {
  console.log(HELP);
  process.exit(specPath ? 0 : 2);
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const errors = [];
const TONES = ["ok", "bad", "warn", "info"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const text = (s, where) => {
  if (typeof s !== "string" || !s.trim()) return errors.push(`${where}: text is missing`), "";
  if (!s.startsWith("@")) return s;
  const hit = spec.phrases?.[s.slice(1)];
  if (!hit) errors.push(`${where}: unknown phrase ${s}`);
  return hit ?? s;
};
const tone = (t, where) => {
  if (t && !TONES.includes(t)) errors.push(`${where}: tone "${t}" is not one of ${TONES.join(", ")}`);
  return t ? ` ${t}` : "";
};
// Returns the chip for an untraced item, or "" for a traced one; records the source for the list.
const plain = (t) => (typeof t === "string" && t.startsWith("@") ? spec.phrases?.[t.slice(1)] ?? t : t ?? "");
// label: what the reader sees in the Sources list, in the scheme's own words (never a spec position).
let inherited = false; // true while rendering a variant marked status: "proposed"
let anySeen = false;
let unlinked = 0;
const evidence = (item, where, sources, label) => {
  if (item?.link && !/^https?:\/\//.test(item.link)) errors.push(`${where}: link must be an http(s) URL`);
  const hasSrc = typeof item?.src === "string" && item.src.trim();
  let seen = "";
  if (item?.seen !== undefined) {
    if (typeof item.seen !== "string" || !item.seen.trim()) errors.push(`${where}: seen must be a non-empty string`);
    else if (!hasSrc || item.status) errors.push(`${where}: seen goes only with src, never with status`);
    else {
      anySeen = true;
      const tip = esc(item.seen);
      seen = ` <span class="chip ok case seen" tabindex="0" data-tip="${tip}" aria-label="seen: ${tip}">seen</span>`;
    }
  }
  if (hasSrc) {
    if (!item.link) unlinked++;
    sources.push({ label: plain(label), text: item.src, link: item.link, seen: seen && item.seen });
    return seen;
  }
  if (item?.status === "proposed" || item?.status === "example") {
    if (item.link) sources.push({ label: plain(label), text: item.status, link: item.link });
    return inherited && item.status === "proposed" ? "" : ` <span class="chip info">${item.status}</span>`;
  }
  if (inherited) return "";
  errors.push(`${where}: needs src ("path:line") or status ("proposed" | "example")`);
  return "";
};
// for: "<caller id>" on an item shows it only while that caller is picked in the switch.
const callerIds = (spec.callers ?? []).map((c) => c.id);
const fo = (item, where) => {
  if (!item?.for) return "";
  if (!callerIds.includes(item.for)) errors.push(`${where}: for "${item.for}" is not in callers[]`);
  return ` data-for="${esc(item.for)}"`;
};
const ARROW = '<i aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5"/></svg></i>';
const chip = (t, cls) => `<span class="chip${cls}">${esc(t)}</span>`;
const caseChips = (ids, where) =>
  (ids ?? []).map((id) => {
    if (!(spec.cases ?? []).some((c) => c.id === id)) errors.push(`${where}: case "${id}" is not in cases[]`);
    const tip = esc(plain((spec.cases ?? []).find((c) => c.id === id)?.text));
    return ` <span class="chip info case" tabindex="0" data-tip="${tip}" aria-label="Case ${esc(id)}: ${tip}">${esc(id)}</span>`;
  }).join("");
const sourceItem = (s) => {
  const src = s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.text)}</a>` : esc(s.text);
  return `<li>${esc(s.label)}: ${src}${s.seen ? `, seen: ${esc(s.seen)}` : ""}</li>`;
};
const sourceList = (sources) =>
  sources.length ? `<details><summary><span>Sources (${sources.length})</span></summary><ol>${sources.map(sourceItem).join("")}</ol></details>` : "";

// One request/response card; used for the shared examples and for a row's or step's own examples.
const card = (ex, where, sources) => {
  const tag = ex.tag ? chip(ex.tag, tone(ex.tone, where)) : "";
  const line = ex.line ? `<div class="line">${esc(ex.line)}</div>` : "";
  return `<div class="code"${fo(ex, where)}><div class="codetop"><b>${esc(text(ex.title, where))}</b><span>${tag}${evidence(ex, where, sources, ex.title)}</span></div>${line}<pre>${esc(ex.body)}</pre></div>`;
};
// The count is what the picked caller sees; a caller with no example of its own gets no toggle.
const exampleCount = (list) => {
  if (!callerIds.length || !list.some((ex) => ex.for)) return { count: String(list.length), hide: "" };
  const per = callerIds.map((id) => [id, list.filter((ex) => !ex.for || ex.for === id).length]);
  return {
    count: per.map(([id, n]) => `<span data-for="${esc(id)}">${n}</span>`).join(""),
    hide: per.filter(([, n]) => !n).map(([id]) => ` data-hide-${esc(id)}`).join(""),
  };
};
const exampleCards = (list, where, sources) =>
  list?.length ? `<details class="exd"${exampleCount(list).hide}><summary><span>Examples (${exampleCount(list).count})</span></summary><div class="grid wide ex">${list.map((ex, i) => card(ex, `${where}.examples[${i}]`, sources)).join("")}</div></details>` : "";

for (const key of ["title", "question"]) if (!spec[key]) errors.push(`${key} is missing`);
if (!spec.variants?.length) errors.push("variants[] is empty");
if (spec.related !== undefined) errors.push("related[] is gone: put each name in links{} and mention it where it belongs");
let ticketRe = null;
if (spec.ticketPattern !== undefined) {
  try {
    if (typeof spec.ticketPattern !== "string" || !spec.ticketPattern) throw new Error("empty");
    ticketRe = new RegExp(spec.ticketPattern, "g");
  } catch {
    errors.push("ticketPattern is not a valid regular expression");
  }
}
// Every mention of a links{} name in the page text becomes a link to it.
const names = Object.entries(spec.links ?? {}).map(([name, link]) => ({ name, link })).sort((a, b) => b.name.length - a.name.length);
for (const r of names) if (!/^https?:\/\//.test(r.link)) errors.push(`links: "${r.name}" must map to an http(s) URL`);

const top = [];
const topSources = [];
if (spec.route?.length) {
  top.push(`<h3>The route (the same in every variant)</h3><div class="grid">${spec.route.map((hop, i) => {
    const where = `route[${i}]`;
    const n = hop.for ? spec.route.slice(0, i).filter((h) => h.for === hop.for).length + 1 : i + 1;
    return `<div class="box"${fo(hop, where)}><b>${n}. ${esc(text(hop.name, where))}</b>${esc(text(hop.does, where))}${evidence(hop, where, topSources, hop.name)}</div>`;
  }).join("")}</div>`);
}
for (const kind of ["requests", "responses"]) {
  if (!spec[kind]?.length) continue;
  top.push(`<h3>Example ${kind}</h3><div class="grid wide">${spec[kind].map((ex, i) => card(ex, `${kind}[${i}]`, topSources)).join("")}</div>`);
}
if (spec.notes?.length) top.push(`<ul>${spec.notes.map((n, i) => `<li${fo(n, `notes[${i}]`)}>${esc(text(typeof n === "string" ? n : n?.text, `notes[${i}]`))}</li>`).join("")}</ul>`);
if (spec.cases?.length) top.push(`<h3>Test cases</h3><ul>${spec.cases.map((c) => `<li>${chip(c.id, " info")} ${esc(text(c.text, `case ${c.id}`))}</li>`).join("")}</ul>`);
// Reading ceiling: about six bullets a block, about ten words a bullet. Over it is a note, never an error.
const notes = [];
const ceiling = (facts, where) => {
  for (const who of callerIds.length ? callerIds : [null]) {
    const seen = (facts ?? []).filter((f) => !f.for || f.for === who);
    const tag = who ? ` (${who})` : "";
    if (seen.length > 6) notes.push(`${where}${tag}: ${seen.length} bullets; keep about six, move the rest into rows or "more"`);
    for (const f of seen) {
      const words = plain(f.text).split(/\s+/).length;
      if (words > 14) notes.push(`${where}${tag}: a ${words}-word bullet ("${plain(f.text).slice(0, 40)}..."); split it or make it a row`);
    }
  }
};
const factList = (facts, where, sources) =>
  (facts ?? []).map((f, i) => `<li${fo(f, `${where}[${i}]`)}>${esc(text(f.text, `${where}[${i}]`))}${evidence(f, `${where}[${i}]`, sources, f.text)}</li>`).join("");
for (const [i, t] of (spec.topics ?? []).entries()) {
  const where = `topics[${i}]`;
  ceiling(t.facts, where);
  top.push(`<div${fo(t, where)}><h3>${esc(text(t.title, where))}</h3><ul>${factList(t.facts, `${where}.facts`, topSources)}</ul></div>`);
}
if (spec.terms?.length) top.push(`<h3>Definitions</h3><ul>${spec.terms.map((t) => `<li><b>${esc(t.term)}</b>: ${esc(t.means)}</li>`).join("")}</ul>`);

const groupsOf = []; // per rows-view variant: its group titles, to compare across variants
const variants = (spec.variants ?? []).map((v, vi) => {
  const at = `variants[${vi}]`;
  const name = `${at} "${plain(v.title)}"`;
  const sources = [];
  if (v.status !== undefined && v.status !== "proposed") errors.push(`${at}: status on a variant can only be "proposed"`);
  inherited = v.status === "proposed";
  const items = v.view === "sequence" ? v.steps ?? [] : (v.rows ?? []).filter((r) => !r.group);
  const bare = items.filter((r) => !r.examples?.length).length;
  if (bare) notes.push(`${name}: ${bare} of ${items.length} ${v.view === "sequence" ? "steps" : "rows"} have no example; give each one request and response`);
  const tags = (v.tags ?? []).map((t) => `<span${fo(t, at)}>${chip(t.text, tone(t.tone, at))}</span>`).join("");
  ceiling(v.facts, `${at}.facts`);
  const facts = factList(v.facts, `${at}.facts`, sources);
  const more = v.more?.facts?.length
    ? `<details class="more"><summary><span>${esc(text(v.more.title ?? "More", `${at}.more`))} (${v.more.facts.length})</span></summary><ul>${factList(v.more.facts, `${at}.more.facts`, sources)}</ul></details>` : "";
  let body = "";
  if (v.view === "sequence") {
    const actors = v.actors ?? [];
    if (actors.length < 2) errors.push(`${at}: a sequence needs at least two actors`);
    const cols = `style="grid-template-columns:repeat(${actors.length},minmax(0,1fr))"`;
    body = `<div class="seq" ${cols}>${actors.map((a) => `<div class="actor">${esc(a)}</div>`).join("")}</div>` +
      (v.steps ?? []).map((s, i) => {
        const where = `${at}.steps[${i}]`;
        const from = actors.indexOf(s.from);
        const to = actors.indexOf(s.to);
        if (from < 0 || to < 0) errors.push(`${where}: from/to must be actors`);
        const [lo, hi] = [Math.min(from, to) + 1, Math.max(from, to) + 2];
        const arrow = from === to ? "↻" : from < to ? "→" : "←";
        return `<div class="seq" ${cols}><div class="step${tone(s.tone, where)}" style="grid-column:${lo}/${hi}">${i + 1}. ${arrow} ${esc(text(s.text, where))}${caseChips(s.cases, where)}${evidence(s, where, sources, s.text)}</div></div>${exampleCards(s.examples, where, sources)}`;
      }).join("");
  } else {
    const columns = v.columns ?? [];
    if (!columns.length) errors.push(`${at}: columns[] is missing`);
    const cols = `style="grid-template-columns:${columns.map((_, i) => `minmax(0,${i < 2 ? 1.3 : 1}fr)`).join(" 16px ")}"`;
    const row = (cells) => `<div class="row" ${cols}>${cells.join(ARROW)}</div>`;
    const head = `<div class="row head" ${cols}>${columns.map((c) => (typeof c === "string" ? `<div>${esc(c)}</div>`
      : Object.entries(c.by ?? {}).map(([id, name]) => `<div${fo({ for: id }, at)}>${esc(name)}</div>`).join(""))).join("<i></i>")}</div>`;
    // A { group } row starts a block: the rows after it fold under its title; a block with no rows is a plain line.
    const blocks = [{ rows: [] }];
    groupsOf.push({ name, titles: (v.rows ?? []).filter((r) => r.group).map((r) => plain(r.group)) });
    (v.rows ?? []).forEach((r, i) => {
        const where = `${at}.rows[${i}]`;
        if (r.group) return blocks.push({ title: esc(text(r.group, where)), open: r.open === true, rows: [] });
        blocks.at(-1).rows.push(renderRow(r, where));
    });
    function renderRow(r, where) {
        if (r.cells?.length !== columns.length) errors.push(`${where}: has ${r.cells?.length ?? 0} cells, columns has ${columns.length}`);
        const first = r.cells?.[0];
        const marks = caseChips(r.cases, where) + evidence(r, where, sources, `if ${typeof first === "string" ? plain(first) : plain(first?.text)}`);
        const label = (ci, id) => {
          const col = columns[ci];
          return ` data-label="${esc(typeof col === "string" ? col : col?.by?.[id] ?? "")}"`;
        };
        const one = (cell, ci, attr, id) => {
          const c = typeof cell === "string" ? { text: cell } : cell;
          const t = esc(text(c?.text, `${where}.cells[${ci}]`));
          if (c?.tone) return `<div class="plain"${attr}${label(ci, id)}>${chip(plain(c.text), tone(c.tone, where))}</div>`;
          return `<div class="${ci === 0 ? "cond" : "cell"}"${attr}${label(ci, id)}>${t}${ci === 0 ? marks : ""}</div>`;
        };
        return row((r.cells ?? []).map((cell, ci) => {
          // { by: { <caller id>: cell } }: one cell per caller, only the picked caller's shows.
          if (cell?.by) return Object.entries(cell.by).map(([id, c]) => one(c, ci, fo({ for: id }, where), id)).join("");
          return one(cell, ci, "");
        })) + exampleCards(r.examples, where, sources);
    }
    body = blocks.map((b) => {
      if (!b.title) return b.rows.length ? head + b.rows.join("") : "";
      if (!b.rows.length) return `<div class="grp">${b.title}</div>`;
      return `<details class="blk"${b.open ? " open" : ""}><summary><span>${b.title}</span></summary>${head}${b.rows.join("")}</details>`;
    }).join("");
  }
  const proposed = inherited ? ' <span class="chip info">proposed</span>' : "";
  const lead = `${tags ? `<p class="tags">${tags}</p>` : ""}${facts ? `<ul>${facts}</ul>` : ""}`;
  return `<section id="v${vi + 1}"><h2>${esc(text(v.title, at))}${proposed}</h2>${lead}${more}${body}${sourceList(sources)}</section>`;
});
const ref = groupsOf.find((g) => g.titles.length);
for (const g of ref ? groupsOf : []) {
  const missing = ref.titles.filter((t) => !g.titles.includes(t));
  const extra = g.titles.filter((t) => !ref.titles.includes(t));
  for (const t of missing) errors.push(`${g.name}: group "${t}" is missing (${ref.name} has it)`);
  for (const t of extra) errors.push(`${g.name}: group "${t}" is extra (${ref.name} has no such group)`);
  const sameSet = !missing.length && !extra.length;
  if (sameSet && g.titles.join("\n") !== ref.titles.join("\n")) errors.push(`${g.name}: groups are in a different order than in ${ref.name}`);
}
if (anySeen) top.push('<p class="legend">seen = observed on a running system; everything else is read from code</p>');
if (unlinked) notes.push(`${unlinked} src with no link; add a permalink "link" next to each`);

const fail = (list) => {
  console.error(`${list.length} problem(s) in ${specPath}:\n- ${list.join("\n- ")}`);
  process.exit(1);
};
if (errors.length) fail(errors);

const CSS = `:root{--bg:#f6f5f1;--card:#fff;--soft:#f1f0ea;--line:#dddbd3;--ink:#1c1b19;--dim:#55534e;--mute:#6b6962;
--ok-b:#e6f2dc;--ok-t:#2c5a0c;--bad-b:#fbe6e6;--bad-t:#8a2020;--warn-b:#fbeed2;--warn-t:#6e4406;--info-b:#e3eefb;--info-t:#0f4a86;
--lift:0 1px 2px rgba(28,27,25,.12);--pop:0 10px 24px -10px rgba(28,27,25,.45);--ease:cubic-bezier(.2,.8,.2,1)}
@media(prefers-color-scheme:dark){:root{--bg:#161614;--card:#1f1f1c;--soft:#2a2a26;--line:#3a3a35;--ink:#ecebe6;--dim:#bdbbb2;--mute:#98968d;
--ok-b:#22380f;--ok-t:#b9dd8f;--bad-b:#451a1a;--bad-t:#f3b0b0;--warn-b:#43300a;--warn-t:#f5cf85;--info-b:#12314f;--info-t:#a9cdf2;
--lift:0 1px 2px rgba(0,0,0,.5);--pop:0 10px 24px -10px rgba(0,0,0,.8)}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scrollbar-color:var(--line) transparent}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
::selection{background:var(--info-b);color:var(--info-t)}
:focus-visible{outline:2px solid var(--info-t);outline-offset:2px;border-radius:6px}
a{color:var(--info-t);text-decoration-thickness:1px;text-underline-offset:2px}a:hover{text-decoration-thickness:2px}
main{max-width:1000px;margin:0 auto;padding:40px 20px 72px}
h1{font-size:28px;line-height:1.15;font-weight:650;letter-spacing:-.02em;margin:0 0 10px;text-wrap:balance}
.q{font-size:16px;color:var(--dim);margin:0 0 12px;max-width:70ch;text-wrap:pretty}
details.refs{margin:0 0 20px}details.refs ul{margin:6px 0 0 14px;padding-left:16px;color:var(--mute)}
.sw{position:sticky;top:0;z-index:6;display:flex;align-items:center;justify-content:space-between;gap:10px 24px;flex-wrap:wrap;margin:0 -20px 20px;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--line);font-size:13px;color:var(--dim)}
.who{display:flex;align-items:center;gap:10px}.seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--soft)}
.seg button{font:inherit;font-weight:500;padding:5px 14px;border-radius:8px;border:0;background:none;color:var(--dim);cursor:pointer;transition:background .15s var(--ease),color .15s var(--ease),box-shadow .15s var(--ease)}
.seg button:hover{color:var(--ink)}.seg button.on{background:var(--card);color:var(--ink);box-shadow:var(--lift)}
.nav{display:flex;gap:2px;flex-wrap:wrap}.nav a{padding:5px 10px;border-radius:8px;color:var(--dim);text-decoration:none;transition:background .15s var(--ease),color .15s var(--ease)}
.nav a:hover{background:var(--soft);color:var(--ink)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 20px;scroll-margin-top:64px}
h2{font-size:19px;line-height:1.3;font-weight:650;letter-spacing:-.01em;margin:0 0 8px;text-wrap:balance}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
h3{font-size:13px;font-weight:600;color:var(--dim);margin:22px 0 8px}section>h3:first-child{margin-top:0}
ul{margin:6px 0;padding-left:18px;color:var(--dim)}li{margin:3px 0;max-width:86ch}li::marker{color:var(--mute)}
.chip{display:inline-block;font-size:12.5px;font-weight:500;line-height:1.4;padding:2px 9px;border-radius:999px;background:var(--soft);color:var(--dim);white-space:nowrap}
.ok{background:var(--ok-b);color:var(--ok-t)}.bad{background:var(--bad-b);color:var(--bad-t)}.warn{background:var(--warn-b);color:var(--warn-t)}.info{background:var(--info-b);color:var(--info-t)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.grid.wide{grid-template-columns:repeat(auto-fit,minmax(270px,1fr));align-items:start}
.box{background:var(--soft);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--dim)}.box b{display:block;font-size:14px;font-weight:600;color:var(--ink);margin-bottom:2px}
.code{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
.codetop{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;font-size:13px;border-bottom:1px solid var(--line)}.codetop b{font-weight:600}
.codetop>span{display:flex;gap:6px;flex-wrap:wrap}
.line{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;padding:7px 12px;color:var(--info-t);border-bottom:1px solid var(--line);word-break:break-all}
pre{margin:0;padding:10px 12px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;background:var(--soft);tab-size:2}
.row{display:grid;gap:8px;align-items:stretch;margin-top:8px;font-size:13px;line-height:1.45}
.row>div{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px;padding:8px 10px;border-radius:8px;min-width:0}
.row>i{display:flex;align-items:center;justify-content:center;color:var(--mute)}.row>i svg{width:14px;height:14px}
.row.head{margin-top:10px;font-size:12px}.row.head>div{padding:0 10px;color:var(--mute)}.row.head>.hl{padding-left:0}
.row .chip{white-space:normal;border-radius:12px}.cell{background:var(--soft)}.cond{position:relative;border:1px solid var(--line);font-weight:500}.plain{padding-left:0!important}
.seq{display:grid;gap:8px;margin-top:8px;font-size:13px}.actor{font-weight:600;padding:4px 10px;border-bottom:1px solid var(--line)}
.step{position:relative;padding:8px 10px;border-radius:8px;background:var(--soft);color:var(--ink)}
.step.ok{background:var(--ok-b);color:var(--ok-t)}.step.bad{background:var(--bad-b);color:var(--bad-t)}.step.warn{background:var(--warn-b);color:var(--warn-t)}.step.info{background:var(--info-b);color:var(--info-t)}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;width:fit-content;max-width:100%;border-radius:8px}summary::-webkit-details-marker{display:none}
summary::before{content:"";flex:none;width:6px;height:6px;margin:0 3px 0 4px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .2s var(--ease)}
details[open]>summary::before{transform:rotate(45deg) translate(-1px,-1px)}summary:hover{color:var(--ink)}
details{margin-top:12px;font-size:13px;color:var(--mute)}details ol{margin:6px 0 0;padding-left:34px}details ol li{max-width:none;overflow-wrap:anywhere}
details.more{margin:8px 0 4px}details.more ul{margin:6px 0 0 14px;color:var(--dim)}details.exd{margin:4px 0 12px 6px;font-size:12.5px}.ex{margin:8px 0 4px 21px}
details.blk,.grp{margin:14px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:14px}
details.blk{color:var(--ink)}details.blk>summary{font-weight:600}details.blk>summary:hover{color:var(--info-t)}
.grp{padding-left:21px;color:var(--mute)}
.case{cursor:help;transition:box-shadow .15s var(--ease)}.case:hover,.case.on{box-shadow:0 0 0 1.5px var(--info-t)}
.case:hover::after,.case:focus-visible::after,.case.on::after{content:attr(data-tip);position:absolute;left:8px;top:calc(100% - 2px);z-index:5;width:max-content;max-width:min(320px,calc(100vw - 64px));white-space:normal;text-align:left;
background:var(--ink);color:var(--bg);padding:8px 10px;border-radius:8px;font-size:12.5px;font-weight:400;line-height:1.45;box-shadow:var(--pop)}
.seen{position:relative}.case.seen::after{left:0;top:calc(100% + 4px)}.codetop .case.seen::after{left:auto;right:0}
.code:has(.seen){overflow:visible}.code:has(.seen) pre{border-radius:0 0 9px 9px}
.legend{margin:14px 0 0;font-size:13px;color:var(--mute)}
@media(max-width:680px){main{padding:24px 14px 56px}.sw{margin:0 -14px 16px;padding:8px 14px}h1{font-size:23px}section{padding:16px}
.row{grid-template-columns:1fr!important;gap:2px;padding:6px;border:1px solid var(--line);border-radius:10px;margin-top:10px}.row>i,.row.head{display:none}
.row>div{padding:6px 8px}.row>div::before{content:attr(data-label);flex-basis:100%;font-size:11.5px;font-weight:400;color:var(--mute)}.cond{border:0}.cell{background:none}.plain{padding-left:8px!important}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}html{scroll-behavior:auto}}
@media print{.sw{position:static}section{break-inside:avoid}}`;

const PICK = `const pick=(id)=>{document.body.dataset.caller=id;document.querySelectorAll("[data-pick]").forEach((b)=>{
const on=b.dataset.pick===id;b.classList.toggle("on",on);b.setAttribute("aria-pressed",on)})};
pick(${JSON.stringify(callerIds[0])});
document.addEventListener("click",(e)=>{const b=e.target.closest("[data-pick]");b&&pick(b.dataset.pick)});
`;
const SCRIPT = `${callerIds.length ? PICK : ""}document.addEventListener("click",(e)=>{const c=e.target.closest(".case");
document.querySelectorAll(".case.on").forEach((x)=>x!==c&&x.classList.remove("on"));c&&c.classList.toggle("on")})`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.title)}</title><style>${CSS}${callerIds.map((id) => `body[data-caller="${esc(id)}"] [data-for]:not([data-for="${esc(id)}"]),body[data-caller="${esc(id)}"] [data-hide-${esc(id)}]{display:none!important}`).join("")}</style></head><body><main>
<h1>${esc(spec.title)}</h1><p class="q">${esc(spec.question)}</p>
${spec.refs?.length ? `<details class="refs"><summary><span>Code read at</span></summary><ul>${spec.refs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></details>` : ""}
<div class="sw">${callerIds.length ? `<div class="who"><span id="who">Who asks</span><div class="seg" role="group" aria-labelledby="who">${spec.callers.map((c, i) => `<button type="button" data-pick="${esc(c.id)}" aria-pressed="${i ? "false" : "true"}"${i ? "" : ' class="on"'}>${esc(c.name)}</button>`).join("")}</div></div>` : "<span></span>"}
<nav class="nav" aria-label="Variants">${(spec.variants ?? []).map((v, i) => `<a href="#v${i + 1}" title="${esc(plain(v.title))}">${esc(plain(v.title).split(/[.:(]/)[0].trim() || `Variant ${i + 1}`)}</a>`).join("")}</nav></div>
${top.length ? `<section>${top.join("")}${sourceList(topSources)}</section>` : ""}
${variants.join("\n")}
</main><script>${SCRIPT}</script></body></html>
`;
// Runs fn over the page text a reader sees as prose: outside links, code, <title>, styles and scripts.
const mapText = (page, fn) => {
  let skip = 0;
  return page.split(/(<[^>]+>)/).map((part) => {
    if (!part.startsWith("<")) return skip ? part : fn(part);
    const tag = /^<(\/?)(a|pre|title|style|script)[\s>]/.exec(part);
    if (tag) skip += tag[1] ? -1 : 1;
    return part;
  }).join("");
};
const linked = !names.length ? html : (() => {
  const pattern = new RegExp(`(?<![\\w-])(${names.map((r) => esc(r.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "g");
  const byName = new Map(names.map((r) => [esc(r.name), r.link]));
  return mapText(html, (part) => part.replace(pattern, (m) => `<a href="${esc(byName.get(m))}" target="_blank" rel="noopener">${m}</a>`));
})();
if (ticketRe) {
  const loose = new Set();
  mapText(linked, (part) => (part.match(ticketRe) ?? []).forEach((id) => id && loose.add(id)) ?? part);
  if (loose.size) fail([...loose].map((id) => `${id} matches ticketPattern and has no links{} entry`));
}
const out = outArg ?? specPath.replace(/(\.scheme)?\.json$/, "") + ".html";
fs.writeFileSync(out, linked);
if (notes.length) console.error(`${notes.length} reading note(s), the page was still written:\n- ${notes.join("\n- ")}`);
console.log(path.resolve(out));
