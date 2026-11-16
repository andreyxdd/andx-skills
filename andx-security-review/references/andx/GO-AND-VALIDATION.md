# Go Services and Input Validation

Rules paraphrased from OpenSSF, [Developing Secure Software (LFD121)](https://training.linuxfoundation.org/training/developing-secure-software-lfd121/), fitted to Go services and the validators in front of them.

## Core discipline

- A validator is a control: trace it with the same six-part boundary as an authorization check, and test it against the input that reaches the sink, not the input the author had in mind.
- Keep input out of code positions: SQL text, a URL path, or a shell argument built by string concatenation from input is the finding; the fix is the parameterized or escaped form, not a stricter regex in front.
- Crypto, TLS, and encoding findings need a consumer that relies on the lost property (integrity, secrecy, unpredictability); a weak primitive nobody trusts is a hardening note.

## Validator defects

- **Unanchored match:** Go `regexp.MatchString` and JS `RegExp.prototype.test` succeed on any substring. An allowlist pattern without `^…$` accepts `evil<valid>evil`.
- **Ungrouped alternation:** `^a|b$` means `(^a)|(b$)`; anchors bind to one branch. Require `^(a|b)$`.
- **Check before parse:** a length, range, or format check on the raw string, then a parse that reads it differently (whitespace, sign, exponent, unit, case folding, Unicode normalization). Check the parsed value.
- **NaN and infinity:** every comparison with NaN is false, so `if x < min || x > max { reject }` lets NaN through; a lower-bound-only check passes `+Inf`. Go `strconv.ParseFloat` and JS `Number()` both accept those spellings. Require an explicit finite check.

## Go sinks

- **SQL:** `fmt.Sprintf` or `+` into `db.Query`/`Exec`/`QueryRow`, gorm `Raw`, `Exec`, `Order`, or `Where` with a built string. Values go in placeholders. Identifiers (ORDER BY column, sort direction, table) cannot be placeholders: they come only from a server-side map keyed by the request value.
- **Internal URL path:** an outbound path built from input (`base + "/accounts/" + id`) without `uuid.Parse` or a strict format check. `url.PathEscape` encodes `/` and `?` but leaves a bare `..` segment, so it alone does not stop traversal to another internal route.
- **Panics:** `net/http` recovers a panic in the handler goroutine, but not in a goroutine the handler starts, and grpc-go recovers none without an interceptor. A panic there or in a shared worker stops the process: state who else loses service.
- **State-changing GET:** a GET that writes, under cookie auth, is cross-site request forgery even with `SameSite=Lax`, which still sends the cookie on top-level GET navigation.

## Outbound TLS and crypto

- **TLS:** `tls.Config{InsecureSkipVerify: true}` on any non-test client, or an `http://` URL for an RPC node, identity provider, signer, or indexer. A response that moves funds or signing keys over an unauthenticated channel is the impact.
- **Deny-list:** MD5 or SHA-1 for integrity or signatures; ECB (in Go, calling `cipher.Block.Encrypt` per block); a static or reused IV or nonce (GCM nonce reuse leaks the auth key); `math/rand` or JS `Math.random` for tokens, keys, or nonces (`crypto/rand` and `crypto.getRandomValues` are the CSPRNGs); a home-made KDF or password hash instead of HKDF, scrypt, Argon2, or bcrypt. Rate only when a consumer relies on the lost property.

## Approval screens

Addresses, account names, or amounts that a human approves are a sink. Bidi controls (U+202A–U+202E, U+2066–U+2069), zero-width characters (U+200B–U+200D), and confusables (Cyrillic U+0430 for Latin `a`) in those fields let the screen show a different value from the one signed. Require rejection or visible escaping on the approval path, and comparison of the exact bytes that get signed.

## Validation rules

- Go `regexp` is RE2 and runs in time linear in the input: no ReDoS. JS, Python `re`, and Java backtrack, so ReDoS stands there.
- Go `encoding/xml` does not resolve external entities: no XXE from it alone.
- Reading a secret from an environment variable is not a finding by itself; logging, returning, or committing it is.
- A committed Kubernetes `Secret` manifest with `data` or `stringData` values is a hardcoded secret: base64 is an encoding.
