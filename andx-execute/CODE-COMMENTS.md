# Code comments (andx execute / review)

Applies to **application source** workers write under `/andx-execute` (and lean-diff under `/andx-mr-create`). Not to plan files, ADRs, or `knowledge/` docs.

## Rules

1. **Code first.** Prefer names, types, tests, and error strings that carry the invariant. Comment only when the *why* is non-obvious from the next 5–10 lines.
2. **No external ADR citations in source.** Ban `ADR-NNN`, `§N`, `see ADR`, `per ADR`, and workspace paths like `repos/knowledge/adrs/…` inside `.go`/`.ts`/`.tsx`/`.cpp`/etc. Reviewers on the MR often lack that file. Put the **invariant in plain English** (one short clause). Policy lives in ADR/`design_refs` — execute from the contract; do not re-cite it in every function.
3. **Short.** Soft cap: **≤2 lines** or **≤160 chars** per comment block next to code. Longer = move to a test name, a named helper, or (if truly architectural) an in-repo `docs/`/`knowledge/` file that **this MR commits**.
4. **No essay / chat residue.** Ban “as discussed”, plan-step talk, andx/agent narration, and restating the next line of code.
5. **Tests.** Test *names* and one-line failure messages state the invariant. Drop ADR refs from `t.Fatalf` / `it('…')` strings unless the ADR file is **in this repo’s diff**.
6. **OK exceptions (still short):** licensed header, generated-file markers, security warnings that name a concrete exploit class.
7. **No harness tags in product source or shipped runbooks.** Ban `ponytail:`, `shrink:`, `andx:`, `caveman`, skill/plugin names, and agent-only branch refs (`andx/exec-*`, worktree slugs) in `.go`/`.ts`/`.cpp`/… comments **and** in checklists/runbooks this MR commits. State the ceiling or upgrade path in plain English (still ≤2 lines). Pin dependencies to **reviewer-facing** branch/MR/tag names and blank “record commit →” fields — not agent run IDs. Reviewers do not know your local tools.
8. **Config contract sync.** If Load uses `getEnvRequired` / fails closed, comments must say **required** — never “optional until…”. Do not “fix” Aikido by weakening chain-RPC env to optional when empty defaults are unsafe (e.g. Solana legacy message has no chain id).
9. **Stacked-MR stubs.** Intentional middle-layer stubs get one short line naming where the real impl lands (`// Stack: full path in VLT-… / !N`). Prefer Aikido reply+resolve over expanding scope.
10. **No PII in logs.** Never log partyName, emails, fingerprints, or truncated forms; presence flags / opaque ids only.
11. **No lint-silence wrappers on existing I/O.** Do not change `json.NewEncoder(w).Encode(...)` to `_ = Encode(...)`, or add `_ = displayedCurrency` / “not wired yet” comments. Ignoring Encode does not change the response. Unused params are legal in Go.

## Rewrite pattern

| Bad | Good |
|-----|------|
| `// ADR-009 §5: balance - fee < rent → reject` | `// Reject if remaining lamports would drop below rent-exempt minimum.` |
| `// Per ADR-009 §7 forbids masterKeys[0]` | `// Pick master by signing algorithm — profile may hold ECDSA and Ed25519.` |
| `// see repos/knowledge/adrs/009-… (out-of-repo)` | *(delete from source; link only from in-repo docs that ship in the MR)* |
| `// ponytail: duplicated from foo.cpp — extract later` | `// Duplicated from foo.cpp — extract a shared helper later if both keep growing.` |
| Checklist pin `andx/exec-solana-sdk-20260723-…` | Public MR branch / tag + `record resolved commit → ________` |

## Where ADRs *do* belong

- Plan `design_refs` / `knowledge_refs` (execute contract)
- In-repo `docs/adr/*` or `knowledge/*` **committed on the same branch**
- MR description **only** if that ADR path is in the MR diff ([STANDARDS.md](../andx-mr-create/STANDARDS.md))

## Review severity

| Finding | Severity |
|---------|----------|
| ADR-/out-of-repo doc cite in product source | **MEDIUM** → fix-or-justify |
| Harness jargon (`ponytail:`, `andx:`, skill names, `andx/exec-*` pins) in source or shipped runbook | **MEDIUM** → rewrite to plain English / public branch before merge |
| Comment a first-time reviewer cannot understand without agent chat | **MEDIUM** → rewrite or delete |
| Comment block >2 lines that restates code or plan chat | **MEDIUM** → shrink/delete |
| Missing invariant that makes behavior unsafe/wrong | still a bug (bugbot/security) — not fixed by adding an ADR cite |

## Pre-push gate (execute / mr-create)

Before push, from `base...HEAD`:

```bash
git diff "$BASE"...HEAD | rg -n '^\+.*(ponytail:|shrink:|andx:|caveman|/andx-|andx/exec-)' && exit 1 || true
```

Fail closed: strip or rewrite hits, then push.
