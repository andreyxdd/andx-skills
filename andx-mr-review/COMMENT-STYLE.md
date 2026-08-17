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

## Annotated examples (from MR 17)

### Bug + Possible fix

```
If the catalog loads before saved settings, `selectedProvider` defaults to `providers[0]`, and the early return on line 69 means we never reconcile when settings arrive for a different stored provider

For example, the profile has provider B saved, catalog returns `[A, B]` → form sticks on A with empty toggles → Save can persist the wrong provider/flags

Possible fix:

```tsx
useEffect(() => {
  if (selectedProvider) return;
  if (!useMocks && (isCatalogLoading || isSettingsLoading)) return;
  const fallback = settings?.provider ?? providers[0]?.provider;
  if (fallback) setSelectedProvider(fallback);
}, [providers, settings, selectedProvider, useMocks, isCatalogLoading, isSettingsLoading]);
```
```

### UX/API (no nitpick prefix)

```
Validate only tests the stored key (`POST .../validate` - no body in the request) but the button is disabled when `!hasApiKey`, so users can't check a key they just typed before committing it

We need to either extend validate to accept a draft `api_key` in the body or make the copy explicit that Save comes first
```

### Nitpick + inline one-liner

```
User may enable the provider and Save with no stored key and an empty input, so the `handleSave` will still send `enabled: true` without an `api_key`. Backend probably rejects it, but a small client guard would save a round trip:

`disabled={isSaving || (providerEnabled && !hasApiKey && !apiKey.trim())}` on Save or bail in `handleSave` with a toast
```

### Nitpick thread reply

```
**nitpick:** the save-then-validate snippet above still only hits the network on button click, not on each typed character — but a fast double-click on Validate could queue two PUT+POST rounds

Low risk; if we care, update the disabled guard:

```tsx
disabled={(!hasApiKey && !apiKey.trim()) || isValidating || isSaving}
```
```
