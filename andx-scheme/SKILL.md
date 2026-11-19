---
name: andx-scheme
description: "/andx-scheme: draw one request traced through the services as a scheme, one card per variant (before / now / target, bug hypotheses, ADR options), every row read from code. Use for \"draw a scheme\", or when a grill, debug or ADR question compares how the same call behaves across versions or designs."
---
# Andx Scheme

One **question**, one **route**, several **variants** of the same route, a few named **cases** → one self-contained HTML file a teammate can open.

Fields: `node render.mjs --help` · Worked spec: [example.scheme.json](./example.scheme.json)

**Fits:** the same call compared across versions (before / now / target), bug hypotheses, or ADR options. A static map of services or a data model is a different drawing; say so and stop.

```
1 Frame → 2 Trace → 3 Write spec → 4 Render → 5 Show
```

## 1. Frame

Settle these six from the conversation; ask once, in one message, for any that is missing.

- **Question**: the one sentence the caller asks ("what is the fee for this transfer?").
- **Route**: the hops the call passes, caller first. The same in every variant.
- **Variants**: 2–4 of them. Versions in time order, or hypotheses, or options.
- **Cases**: 2–3 concrete inputs, lettered A, B, C, chosen so the variants answer them differently.
- **Callers**: every client that calls the endpoint, found by searching for its callers; one `callers[]` entry each.
- **Spread**: the dimension the answer varies along (networks, tenants, plans). Every member is a group in every variant with its own rows: the main one open, the rest folded. A group title is the member's name, a colon, then its state in that variant.

## 2. Trace

Two kinds of evidence, both read-only:

- **Code**: for every variant × case, read the code that decides the answer at a named ref (`git show <ref>:<path>`, no fetch) and note `path:line`. Read what the next hop does with that answer, up to each caller, and that caller's own handling at every step of its flow (form, review, submit). Request and response shapes come from the request types.
- **Runtime**: what the running system actually said. Reach for it when a variant is deployed and the question is about a real event (a bug, an incident, a stuck order), or when the code leaves a branch open (config, flags, data). Sources, whichever the workspace gives access to: service logs (log search, `kubectl logs`), the incident ticket, traces, a debug endpoint, a read-only query. Note it as `src` with what and when: `log: {service} "fee estimate failed" 2026-01-10 13:03`. Copy status codes and bodies exactly; mask secrets, tokens and personal data.

Code says what can happen; runtime says what did. When they disagree (the log shows a status the code at that ref cannot produce), the deployed build differs from the ref: find the deployed version and trace that one, and say so in `refs`. For every deployed variant `refs` names where its build runs: environment and image or tag.

`seen` marks what was observed on a running system, with where and when. A consequence read from code stays unmarked, and chat words it as read from code.

Runtime access that is missing, or needs a grant the workspace rules put behind the user, is a one-line note in chat, and the row stays code-traced.

What cannot be read gets a status: `proposed` for a design that is not merged, `example` for an illustrative value such as a made-up amount.

Done when every route hop, request, response, fact, row and step carries a `src` or a `status`, and each case is tagged on the row it hits in every variant.

## 3. Write the spec

`SCHEMES=$PLANS_DIR/schemes` (`PLANS_DIR=` from `node ~/.agents/skills/andx-orchestration/scripts/run.mjs dirs --ensure`). Copy `example.scheme.json` to `$SCHEMES/<slug>.scheme.json` and fill it.

- **rows** view (default): one row per branch, columns such as `if → <service> does → answers → <caller> receives`. Use it when the variants differ in a decision.
- **sequence** view: numbered steps between actors. Use it when order in time is the point: retries, queues, async workers, callbacks.

Wording, for a reader outside the team:

- Plain words. Each line makes sense to someone who has never used the third-party product behind it. A word specific to this system gets one line in `terms`, with an everyday comparison when the idea is abstract; domain basics stay out.
- Conditions use concrete numbers: "wallet holds 0.001, transfer asks 0.01".
- Same behavior, same words: a sentence that holds in two or more variants lives once in `phrases` and is written `@key` everywhere.
- `facts` are read, rows are scanned. Keep each block of `facts` to about six bullets of about ten words; the renderer prints a note when one goes over. Cut by moving, not deleting: a sentence that says "if … then …" is a row, a reason or side note goes in `more`, and what holds in every variant goes once in `topics`.
- Label things by what they are: "Example request", "Example response", "Test cases".
- Tone marks the outcome for the caller: `ok` works, `bad` breaks, `warn` works on a guess, `info` neutral.

Evidence a reader can follow:

- Every ticket or merge request mention is a `links{}` name; `ticketPattern` is the workspace's ticket id format.
- Every `src` gets a permalink `link`, and each row or step one example request and response.
- A variant that is wholly a proposal takes `status: "proposed"` once.

## 4. Render

```
node ~/.agents/skills/andx-scheme/render.mjs "$SCHEMES/<slug>.scheme.json"
```

It prints the HTML path, or lists every problem and writes nothing. Fix the spec until it prints a path. The HTML is output only: every later change goes into the spec, then render again.

## 5. Show

Open the HTML for the user with the harness's file preview when it has one; in every harness print the absolute path. Then, in chat:

- the answer to the question in one or two lines (which variant breaks which case);
- every row marked `proposed` or `example`, so the reader knows what is not yet real;
- an offer to attach the HTML to the ticket or thread it belongs to, as a snapshot to re-attach after each re-render.
