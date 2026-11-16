---
name: andx-security-review
description: "/andx-security-review: diff-scoped security review with boundary-proven findings, Cloudflare attack-class router, and refuted critical/high. Use for \"security review\" of a branch/MR, or as the andx Security reviewer."
---
# Andx Security Review

Find vulnerabilities that cross a real trust boundary in a diff, prove them from source, and give the smallest fix. Read-only. Attack classes and severity anchors come from Cloudflare security-audit (MIT, [references/cloudflare/](references/cloudflare/ATTRIBUTION.md)).

## Modes

| Mode | Caller | Scope | Output |
|------|--------|-------|--------|
| `gate` | `andx-security-reviewer` agent (andx Security reviewer) | `git diff $MERGE_BASE_SHA..$EXEC_HEAD` only | `## VERDICT` + candidates JSON |
| `standalone` | user (`/andx-security-review`, `/security-review`) | branch diff vs merge-base (default), MR diff, or named subsystem | markdown report + same JSON |

Stacked MR: base is the parent MR head, never the default branch. Findings about code outside the scope are dropped as wrong-base.

## Workflow

### 0. Scope and fast path

`git diff --stat <base>..<head>`. Diff touches only docs/comments/tests with no fixtures of secrets → `PASS`, note "no security surface". Lockfile/CI/Dockerfile/IaC changes always get a pass (supply-chain / cloud class). An added suppression (`#nosec`, `nolint:gosec`, `nosemgrep`, `gitleaks:allow`, `eslint-disable` of a security rule) or a deleted or loosened deny-path test is review surface: no fast path.

### 1. Scanner prepass

Probe each scanner with `command -v` and record `RAN` or `NOT_RUN` in the output; `NOT_RUN` never counts as clean.

- gitleaks, both modes: `gitleaks git --no-banner --redact --log-opts="<base>..<head>"`
- govulncheck, both modes, when the diff touches Go: `govulncheck ./...` from the module root. Attribute only vulnerabilities in a module the diff adds or bumps, or on a call path it adds; no vulnerability database → `NOT_RUN`.
- gosec and semgrep, standalone only: `gosec ./...`, `semgrep scan --config p/default --metrics off`

gitleaks `NOT_RUN` → grep added lines:

```bash
git diff <base>..<head> | rg -n '^\+.*(-----BEGIN|AKIA[0-9A-Z]{16}|xox[baprs]-|ghp_[A-Za-z0-9]{36}|(api[_-]?key|secret|password|token)\s*[:=]\s*["'\''][^"'\'']{8,})'
```

Each dependency the diff adds: check for a lookalike of a popular package name, a registry or source that differs from the lockfile norm, and a name missing from the registry or new and little-used there (slopsquatting on AI-suggested names).

### 2. Surface map

Every untrusted entry point the diff adds or changes (routes, resolvers, RPC, webhooks, queue consumers, CLI args, env/config reads, file/deserialization, IPC, LLM tool calls). For each: reachability tier from [SEVERITY.md](SEVERITY.md).

### 3. Workspace review gates

Load review gates per [workspace rules](../andx-orchestration/WORKSPACE-RULES.md); violations are findings at the gate severity.

### 4. Class router

Pick companions from what the diff touches; read [ATTACK-CLASSES.md](references/cloudflare/ATTACK-CLASSES.md) core classes (injection, access control, resources/files, crypto/secrets, business logic, feature abuse, chains, obvious things) always.

| Diff touches | Companion |
|--------------|-----------|
| HTTP handlers, sessions, JWT/OAuth/OIDC/SAML, MFA, API keys, mTLS, proxies | [WEB-PROTOCOL-AND-AUTH](references/cloudflare/WEB-PROTOCOL-AND-AUTH.md) |
| SPA/DOM, extensions, webviews, postMessage, CORS, WebSockets | [CLIENT-SIDE](references/cloudflare/CLIENT-SIDE.md) |
| Dependencies, lockfiles, CI, release/signing, plugins | [SUPPLY-CHAIN-AND-RELEASE](references/cloudflare/SUPPLY-CHAIN-AND-RELEASE.md) |
| IAM, IaC, k8s/Helm, containers, serverless, ingress | [CLOUD-AND-DEPLOYMENT](references/cloudflare/CLOUD-AND-DEPLOYMENT.md) |
| gRPC, GraphQL, protobuf, queues, pub/sub, webhooks | [PROTOCOLS-RPC-AND-MESSAGING](references/cloudflare/PROTOCOLS-RPC-AND-MESSAGING.md) |
| Unbounded work, pagination, uploads, fan-out, paid APIs | [RESOURCE-EXHAUSTION-AND-AVAILABILITY](references/cloudflare/RESOURCE-EXHAUSTION-AND-AVAILABILITY.md) |
| Multi-tenant data, caches, export/backup, deletion, migrations | [DATA-ISOLATION-AND-LIFECYCLE](references/cloudflare/DATA-ISOLATION-AND-LIFECYCLE.md) |
| Native mobile/desktop, deep links, local daemons, IPC | [DESKTOP-MOBILE-AND-LOCAL-IPC](references/cloudflare/DESKTOP-MOBILE-AND-LOCAL-IPC.md) |
| C/C++/unsafe Rust, FFI, parsers, crypto/MPC cores | [MEMORY-SAFETY-AND-BINARY](references/cloudflare/MEMORY-SAFETY-AND-BINARY.md) |
| LLM prompts, RAG, agent tools, MCP | [AI-AND-LLM](references/cloudflare/AI-AND-LLM.md) |
| Go services, input validators, outbound TLS, crypto choices, approval UIs | [GO-AND-VALIDATION](references/andx/GO-AND-VALIDATION.md) |

From each selected companion apply its **Core discipline**, **Universal moves**, and **Validation rules** sections verbatim.

### 5. STRIDE pass with boundary tuple

Walk Spoofing, Tampering, **Repudiation** (who-did-what logs, tamper-evidence), Information disclosure, Denial of service, Elevation of privilege over each surface. Every candidate states all six:

1. lower-trust principal and starting capability
2. accepted input, action, or state transition
3. intended control (file:line, or "absent" with where it should be)
4. crossed boundary
5. affected principal or resource
6. concrete result (wrong record, unauthorized action, disclosure, outage)

Per surface, also:

- Enumerate every error and default branch of a new or changed guard; a branch that fails open (allows on error, missing value, unknown enum) defeats the control.
- A client-side-only check or obscurity (hidden route; sequential, short, or listed/logged id) is an absent control. A CSPRNG token of at least 128 bits that is itself the credential (reset or invite token, share link, presigned URL, webhook secret) is a control.
- A privileged action now gated by fewer independent conditions: [SEVERITY.md](SEVERITY.md) rule 5.
- A value held both as a stored or verified copy and as request input: the sink must take the stored copy.
- A privileged state change (role, key, limit, approval, withdrawal address) with no audit record is a Repudiation finding.
- The diff fixes a vulnerability → `rg` the repo for the same pattern; list unfixed variants on the `variants:` output line, not as findings (out-of-diff files drop as wrong-base).

### 6. Candidate gate (Cloudflare, adapted)

1. Complete source trace from entrypoint to sink, including the strongest source-visible control. Green tests over mocks of the guarded boundary are not evidence of a control.
2. Do not strengthen a crash into RCE, ordinary work into shared outage, or a same-principal action into privilege gain.
3. Decisive fact outside source (proxy, IdP, deploy config) → `needs_validation` with the exact missing fact; no severity.
4. Missing best practice with no affected principal → hardening note, not a finding.
5. Fingerprint = stable root-cause slug (`^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`, no line, round, or severity).
6. Nothing survives → empty candidate list.

### 7. Severity and refutation

Severity per [SEVERITY.md](SEVERITY.md). Each critical/high is `proposed` until the **parent** spawns one `andx-refuter` per candidate with [VERIFIER.md](VERIFIER.md). Only `confirmed` critical/high blocks.

## Output

```
## VERDICT
status: BLOCK | PASS
secrets_scan: RAN | NOT_RUN
scanners: <name>=RAN|NOT_RUN per other scanner that applies
variants: <file:line>, … (unfixed copies of a fixed pattern; omit when none)
blockers:
  - [CRITICAL|HIGH] <file:line> — <one line> (fingerprint)
advisory:
  - [MEDIUM|LOW|NEEDS_VALIDATION] <file:line> — <one line>
```

Then a fenced JSON array of candidates: `{id, severity, status, location, finding, reachability, trace[], conditions[], blockers[], validation_plan, fix}` (FINDINGS-SCHEMA v2 finding shape). Gate mode status before refutation: `proposed` for critical/high.

Standalone adds: summary (1–3 sentences), **Hardening notes and positive patterns**, **Non-findings considered**, **Out of scope**.

## Disclosure

Critical/high in a public repo: private advisory or private channel per the repo's security policy, never a public issue or MR comment with exploit detail.

## Anti-patterns

- Checklist deviations or missing headers presented as vulnerabilities
- Guessing proxy/IdP/deploy behavior instead of `needs_validation`
- Severity on `needs_validation`; severity above demonstrated impact
- Reviewing code outside the diff scope; reviewer-spawned refuters
- Live or shared-environment probing; editing code during review
