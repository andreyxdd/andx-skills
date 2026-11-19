import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RENDER = join(here, "..", "render.mjs");
const EXAMPLE = join(here, "..", "example.scheme.json");

// Writes the spec to a temp dir, runs the CLI, returns exit code, stderr and the page (null when not written).
const render = (spec) => {
  const dir = mkdtempSync(join(tmpdir(), "andx-scheme-"));
  try {
    const specPath = join(dir, "t.scheme.json");
    const out = join(dir, "t.html");
    writeFileSync(specPath, JSON.stringify(spec));
    const r = spawnSync(process.execPath, [RENDER, specPath, out], { encoding: "utf8" });
    return { status: r.status, stderr: r.stderr, html: existsSync(out) ? readFileSync(out, "utf8") : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const count = (html, needle) => html.split(needle).length - 1;

const EX = { title: "Quote request", body: '{"sku":"CHAIR-7"}', status: "example" };
const fact = (text) => ({ text, src: "pricing/quote.go:10", link: "https://example.com/quote.go#L10" });
const row = (cond, more = {}) => ({
  cells: [cond, "422"],
  src: "pricing/quote.go:20",
  link: "https://example.com/quote.go#L20",
  examples: [EX],
  ...more,
});
// One rows-view variant with a linked fact and a linked row that has an example: no errors, no notes.
const base = (variant = {}) => ({
  title: "Quote",
  question: "What does pricing answer?",
  variants: [{ title: "Now", facts: [fact("Stock is checked first")], columns: ["if", "answers"], rows: [row("stock is 0")], ...variant }],
});

test("the example spec renders with no errors and no reading notes", () => {
  const r = render(JSON.parse(readFileSync(EXAMPLE, "utf8")));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.html.startsWith("<!doctype html>"));
});

test("a clean spec prints no notes", () => {
  const r = render(base());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
});

test("an item with no src and no status exits 1 and writes nothing", () => {
  const r = render(base({ facts: [{ text: "Stock is checked first" }] }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /variants\[0\]\.facts\[0\]: needs src/);
  assert.equal(r.html, null);
});

test("an unknown @phrase is an error", () => {
  const r = render(base({ facts: [fact("@nope")] }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown phrase @nope/);
});

test("with callers, Examples shows each caller's own count and hides the toggle for a caller with none", () => {
  const spec = base({
    rows: [row("stock is 0", { examples: [{ ...EX, for: "app" }, { ...EX, title: "Second", for: "app" }] })],
  });
  spec.callers = [{ id: "app", name: "App" }, { id: "web", name: "Web" }];
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.html.includes('Examples (<span data-for="app">2</span><span data-for="web">0</span>)'));
  assert.ok(r.html.includes('<details class="exd" data-hide-web>'));
});

test("a links{} name is linked in a fact and left alone inside a <pre> body", () => {
  const spec = base({
    facts: [fact("Tracked in SHOP-12 since May")],
    rows: [row("stock is 0", { examples: [{ ...EX, body: "see SHOP-12" }] })],
  });
  spec.links = { "SHOP-12": "https://example.com/t/12" };
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.html.includes('Tracked in <a href="https://example.com/t/12" target="_blank" rel="noopener">SHOP-12</a> since May'));
  assert.ok(r.html.includes("<pre>see SHOP-12</pre>"));
});

test("related[] is rejected with a pointer to links{}", () => {
  const spec = base();
  spec.related = [{ name: "SHOP-12", link: "https://example.com/t/12", text: "the bug" }];
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /related.*links\{\}/);
  assert.equal(r.html, null);
});

test("ticketPattern: each unlinked id is one error naming it", () => {
  const spec = base({ facts: [fact("Tracked in SHOP-12 and SHOP-34"), fact("SHOP-34 again, and SHOP-56")] });
  spec.ticketPattern = "SHOP-\\d+";
  spec.links = { "SHOP-12": "https://example.com/t/12" };
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^2 problem/);
  assert.equal(count(r.stderr, "SHOP-34"), 1);
  assert.equal(count(r.stderr, "SHOP-56"), 1);
  assert.equal(count(r.stderr, "SHOP-12"), 0);
  assert.equal(r.html, null);
});

test("ticketPattern: linked ids and ids inside <pre> pass", () => {
  const spec = base({
    title: "Now, after SHOP-12",
    facts: [fact("Tracked in SHOP-12")],
    rows: [row("stock is 0", { examples: [{ ...EX, body: "log line SHOP-99" }] })],
  });
  spec.ticketPattern = "SHOP-\\d+";
  spec.links = { "SHOP-12": "https://example.com/t/12" };
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
});

test("ticketPattern: an invalid pattern is an error; without it nothing is checked", () => {
  const spec = base({ facts: [fact("Tracked in SHOP-12")] });
  assert.equal(render(spec).status, 0);
  spec.ticketPattern = "SHOP-(\\d+";
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ticketPattern/);
});

test("groups: variants must carry the same group titles in the same order", () => {
  const variant = (title, groups) => ({
    title,
    facts: [fact("Stock is checked first")],
    columns: ["if", "answers"],
    rows: groups.flatMap((g) => [{ group: g }, row(`stock is 0 in ${g}`)]),
  });
  const spec = (second) => ({ ...base(), variants: [variant("Now", ["Retail", "Wholesale"]), variant("Target", second)] });

  assert.equal(render(spec(["Retail", "Wholesale"])).status, 0);

  const missing = render(spec(["Retail"]));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /"Target".*"Wholesale".*missing/);

  const extra = render(spec(["Retail", "Wholesale", "Outlet"]));
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /"Target".*"Outlet".*extra/);

  const order = render(spec(["Wholesale", "Retail"]));
  assert.equal(order.status, 1);
  assert.match(order.stderr, /"Target".*order/);

  const none = render(spec([]));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /"Target".*"Retail".*missing/);
});

test("groups: a @phrase title counts as its expanded text; a sequence variant is exempt", () => {
  const spec = base({ rows: [{ group: "@retail" }, row("stock is 0")] });
  spec.phrases = { retail: "Retail" };
  spec.variants.push({ ...spec.variants[0], title: "Target", rows: [{ group: "Retail" }, row("stock is 0")] });
  spec.variants.push({
    title: "Later",
    view: "sequence",
    actors: ["Shop", "Pricing"],
    steps: [{ from: "Shop", to: "Pricing", text: "asks the price", src: "shop/quote.ts:1", link: "https://example.com/q#L1", examples: [EX] }],
  });
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
});

test("variant status proposed: one chip by the title, items need no evidence, own src and example stay", () => {
  const r = render(base({
    status: "proposed",
    facts: [{ text: "Pricing falls back to the list price" }, { text: "Said twice", status: "proposed" }],
    more: { facts: [{ text: "A side note" }] },
    rows: [
      { cells: ["stock is 0", "200"], examples: [{ title: "Bare card", body: "{}" }, EX] },
      row("stock is 5"),
    ],
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(count(r.html, ">proposed</span>"), 1);
  assert.ok(r.html.includes('<h2>Now <span class="chip info">proposed</span></h2>'));
  assert.equal(count(r.html, ">example</span>"), 2);
  assert.ok(r.html.includes("<summary><span>Sources (1)</span></summary>"));
  assert.ok(r.html.includes("pricing/quote.go:20"));
});

test("variant status: only proposed is accepted; other variants still need evidence", () => {
  const bad = render(base({ status: "example" }));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /variants\[0\]: status/);

  const spec = base({ status: "proposed", facts: [{ text: "No evidence here" }] });
  spec.variants.push({ ...base().variants[0], title: "Target", facts: [{ text: "Nor here" }] });
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^1 problem/);
  assert.match(r.stderr, /variants\[1\]\.facts\[0\]: needs src/);
});

test("seen: chip with the text, the text in Sources, and one legend line", () => {
  const SEEN = "staging 2026-01-10, direct request";
  const r = render(base({ facts: [{ ...fact("Pricing answers 422"), seen: SEEN }] }));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.html.includes(`tabindex="0" data-tip="${SEEN}" aria-label="seen: ${SEEN}">seen</span>`));
  assert.ok(r.html.includes(`>pricing/quote.go:10</a>, seen: ${SEEN}</li>`));
  assert.equal(count(r.html, "seen = observed on a running system; everything else is read from code"), 1);
});

test("seen: no legend without it; needs src; never with status; never empty", () => {
  assert.equal(count(render(base()).html, "observed on a running system"), 0);

  const noSrc = render(base({ status: "proposed", facts: [{ text: "Pricing answers 422", seen: "staging" }] }));
  assert.equal(noSrc.status, 1);
  assert.match(noSrc.stderr, /variants\[0\]\.facts\[0\]: seen/);

  const withStatus = render(base({ facts: [{ text: "Pricing answers 422", status: "example", seen: "staging" }] }));
  assert.equal(withStatus.status, 1);
  assert.match(withStatus.stderr, /variants\[0\]\.facts\[0\]: seen/);

  const empty = render(base({ facts: [{ ...fact("Pricing answers 422"), seen: " " }] }));
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /variants\[0\]\.facts\[0\]: seen/);
});

test("reading notes: rows without an example, one line per variant; the page is still written", () => {
  const bare = (cond) => row(cond, { examples: undefined });
  const spec = base({ rows: [bare("stock is 0"), row("stock is 5"), bare("stock is 9")] });
  spec.variants.push({
    title: "Target",
    view: "sequence",
    actors: ["Shop", "Pricing"],
    steps: [{ from: "Shop", to: "Pricing", text: "asks the price", src: "shop/quote.ts:1", link: "https://example.com/q#L1" }],
  });
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.html);
  assert.match(r.stderr, /^2 reading note/);
  assert.match(r.stderr, /"Now": 2 of 3 rows have no example/);
  assert.match(r.stderr, /"Target": 1 of 1 steps have no example/);
});

test("reading notes: one summary line counts every src with no link", () => {
  const spec = base({ facts: [{ text: "Stock is checked first", src: "pricing/quote.go:10" }] });
  spec.route = [{ name: "Shop", does: "asks the price", src: "shop/quote.ts:1" }];
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^1 reading note/);
  assert.match(r.stderr, /2 src with no link/);
});

test("ticketPattern: an id with a links{} entry passes inside a longer token; one without still fails there", () => {
  const spec = base({ facts: [fact("Branch feature/SHOP-12-fallback is deployed")] });
  spec.ticketPattern = "SHOP-\\d+";
  spec.links = { "SHOP-12": "https://example.com/t/12" };
  const ok = render(spec);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.html.includes("Branch feature/SHOP-12-fallback is deployed"));

  spec.variants[0].facts.push(fact("Branch feature/SHOP-77-retry is not"));
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^1 problem/);
  assert.match(r.stderr, /SHOP-77/);
});

test("ticketPattern: an unlinked id in a case text is an error", () => {
  const spec = base({ rows: [row("stock is 0", { cases: ["A"] })] });
  spec.cases = [{ id: "A", text: "the order from SHOP-41" }];
  spec.ticketPattern = "SHOP-\\d+";
  const r = render(spec);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SHOP-41/);
  assert.equal(r.html, null);
});

test("a toned first cell keeps the row's seen and case chips", () => {
  const spec = base({
    rows: [{ ...row("unused"), cells: [{ text: "stock is 0", tone: "bad" }, "422"], cases: ["A"], seen: "staging 2026-01-10" }],
  });
  spec.cases = [{ id: "A", text: "0 in stock" }];
  const r = render(spec);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(count(r.html, ">seen</span>"), 1);
  assert.equal(count(r.html, 'aria-label="Case A: 0 in stock">A</span>'), 1);
});

test("a callers[] id outside letters, digits, _ and - is an error", () => {
  for (const id of ["</script><img src=x onerror=alert(1)>", "b onmouseover=alert(2) x"]) {
    const spec = base();
    spec.callers = [{ id, name: "App" }];
    const r = render(spec);
    assert.equal(r.status, 1, id);
    assert.ok(r.stderr.includes(`callers[0]: id "${id}"`), r.stderr);
    assert.equal(r.html, null);
  }
});

test("the example spec keeps shared examples, notes and a sequence variant", () => {
  const spec = JSON.parse(readFileSync(EXAMPLE, "utf8"));
  for (const key of ["requests", "responses", "notes"]) assert.ok(spec[key]?.length, key);
  assert.equal(spec.variants.filter((v) => v.view === "sequence").length, 1);
});
