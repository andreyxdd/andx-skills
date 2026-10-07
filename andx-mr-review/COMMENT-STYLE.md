# MR comment style (MR-17 anchor)

Human review comments for GitLab/GitHub. Chat report uses [REPORT-FORMAT.md](./REPORT-FORMAT.md); MR body stays short.

## Voice

- Direct, colleague-to-colleague
- No intro/outro ("great work", "overall LGTM")
- No emoji
- Present tense for bugs; imperative for fixes

## Structure

1. **Problem** — what breaks or confuses (one short paragraph)
2. **Repro** — concrete path with arrows: `A → B → C`
3. **Fix** — `Possible fix:` + minimal code **or** one-line inline guard
4. **Alternative** — lowercase parenthetical when multiple valid paths

## Severity in prose

| Severity | MR treatment |
|----------|----------------|
| high / medium | Plain text; no prefix |
| low | Plain text or fold into summary |
| nitpick | Prefix `**nitpick:**` on first line |

Do not use `HIGH:` / `CRITICAL:` labels in MR comments (reserved for VERDICT in execute-and-review).

## Code references

- Backticks for symbols, endpoints (`POST .../validate`), flags
- File paths without line numbers in prose; line numbers in host inline position only
- Fix blocks: `tsx` / `ts` / language tag; minimal comments inside

## Fix snippet rules

- Show the smallest change that fixes the issue
- Mask secrets (`glpat-xxx`, real API keys)
- For long handlers, show only the changed lines + `// ...` if needed
- One-line guards may be inline after colon instead of a block

## Threading

- New issue → new inline thread (`--file --line`)
- Follow-up on same topic → `--reply <discussion-id>` (e.g. double-click guard on validate thread)
- Never edit the user's existing comment text — **append** snippets only when asked (`--append-snippet`)

## Posting layout

1. Optional **summary note** (`--resolvable=false`) — table + CI warning
2. **Inline threads** — bugs/medium/high (cap ~8; overflow in summary)
3. **Nitpicks** — separate sub-prompt before post (default: chat report only)

## Anti-patterns

- Essay-length MR comments (depth → chat report)
- Generic checklist without file/line
- `**nitpick:**` on real bugs
- Posting without user approval (unless `--post` explicitly passed)

## Examples

Golden examples (high, medium, UX/API, nitpicks, thread reply): [EXAMPLES.md](./EXAMPLES.md).
