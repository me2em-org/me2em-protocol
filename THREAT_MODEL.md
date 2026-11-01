# Me2eM Protocol — Threat Model

**Status:** normative companion to [`specs/v1.0.md`](./specs/v1.0.md),
applies to `@me2em/core` **1.0.0-rc.1** (the API-freeze release candidate).
Last updated: 2026-11-01 (PR-12). Reporting a vulnerability:
[`SECURITY.md`](./SECURITY.md). Practical hardening guidance:
[`packages/core/README.md` → Security Best Practices](./packages/core/README.md#%EF%B8%8F-security-best-practices).

This document states what Me2eM protects, against whom, with which
mechanisms — and, equally important, what it explicitly does **not**
protect against. Every mitigation below is enforced by code and pinned
by tests in the repository ("enforced by tests, not by convention",
specs/v1.0.md §11).

---

## 1. Assets

| # | Asset | Carried by |
|---|-------|-----------|
| A1 | **Seed** (64-byte BIP39, optional passphrase) | User memory/paper only — the single permanent carrier of identity |
| A2 | **Private keys** (identity / Handle / SubHandle Ed25519) | RAM only, `#private` fields, zeroized on `dispose()` |
| A3 | **Derived secrets** (passwords, channel keys, shared secrets) | Computed on demand, never stored by the library |
| A4 | **Attestation chain integrity** — who may grant what to whom | Signed tokens (`me2em/attestation/v1`) |
| A5 | **Session token integrity and freshness** | Signed tokens (`me2em/session/v1`) |
| A6 | **The verifier's authorization decision** | Correct execution of `verifyStateless` / `verifyAttested` |

## 2. Trust roles and boundaries

| Role | Holds | Trust assumptions |
|------|-------|-------------------|
| **Identity holder** (client device) | Seed, derived keys | The device runtime is not malware-compromised (see §6) |
| **Issuer / root** | The identity (depth 0) | Trusted by construction — every attestation chain starts at its public key |
| **Verifier (attested mode)** | Root **public** key + presented chain | Untrusted network between parties; verifier clock within ±30 s of true time |
| **Verifier (stateless mode)** | Identity key material | Only for infrastructure the identity owner fully controls (README "Verification modes") |
| **Network** | — | Fully hostile: observe, modify, replay, inject any traffic |

Trust decreases along the chain: the root attests Handles, a Handle
attests at most one SubHandle level (`MAX_DEPTH = 2` — a SubHandle is
always a leaf), and a session is signed by the leaf key it claims
(`hId`). A verifier accepts nothing beyond what the chain, the grants
and the signature chain jointly prove.

## 3. Adversary model

The adversary is assumed to be able to:

1. **Control the network** between holder, issuer and verifier — read,
   drop, reorder, modify, replay and inject messages at will.
2. **Submit arbitrary input** to every public parsing surface
   (`Attestation.decode`, `verifySignature`, `Session.verifyStateless`,
   `Session.verifyAttested`) — oversized payloads, hostile JSON,
   prototype-polluting keys, wrong types, malformed base64url, forged
   signatures.
3. **Act as a malicious holder**: possess a legitimate SubHandle key and
   its attestation, and attempt privilege escalation (scopes, TTL,
   audiences, deeper chains, name wildcards).
4. **Manipulate clocks** within operational limits (§5.7).
5. **Observe public state**: revocation-store membership queries,
   published root public keys, public tokens.

The adversary is **not** assumed to: break Ed25519 / HKDF-SHA256 /
SHA-256 / X25519; compromise the holder's device runtime; compromise the
verifier's host; obtain the seed (A1 secrecy is an assumption, not a
guarantee — §6).

## 4. Mitigation inventory (verified mechanisms)

| Mechanism | Where | Pinned by |
|-----------|-------|-----------|
| Deterministic Ed25519 signatures (RFC 8032) over canonical payload bytes | all tokens | golden vectors `specs/test-vectors.json` |
| HKDF-SHA256 (RFC 5869) with domain-separated `me2em/…/vN` info strings | all derivation | vectors + `test/revisions.spec.ts` |
| `#private` key fields, defensive copies, constructor input copying, `toJSON`/`inspect` redaction | `Identity`/`Handle`/`SubHandle` | encapsulation tests (`Handle.prototype.sign.call(fakeThis)` TypeError, redaction) |
| `dispose()` → `fill(0)` + `DisposedError` on every capability method | all three classes | lifecycle tests |
| `Signer` interface — raw private keys never cross a trust boundary as arguments | `Attestation.issue` | PR-6 tests |
| Grant nesting: child scopes ⊆ parent scopes, child `maxTtl` ≤ parent, audience containment; `SCOPE_EXCEEDED` / `TTL_EXCEEDED` / `AUDIENCE_NOT_PERMITTED` at level `ROOT` | `verifyAttested` step 10–11 | attested-suite (28 cases) |
| Chain structure: 1 attestation (Handle session) / 2 attestations (SubHandle session); path agreement child → parent; `hId == B.subjectId` | `#verifyChainStructure`, `#verifyHandleAttestation` | attested-suite |
| `MAX_DEPTH = 2`, SubHandle is a leaf → `MAX_DEPTH_EXCEEDED` | derivation + verification | error-table test (5.8) |
| `jti` validation (non-empty, ≤ 256 chars) + `RevocationChecker` consulted for attestation **and** session `jti` (root, handle and session levels) | parsers + `verifyAttested` | attested-suite, error-table |
| Time windows with ±30 s tolerance (`CLOCK_SKEW_SECONDS`) at every level; session cannot outlive the earliest attestation expiry | `verifyStateless`, `verifyAttested` steps 3/7/9 | attested-suite |
| Payload caps **before** decode: attestation 2048 B (exported `ATTESTATION_MAX_PAYLOAD`), session 4096 B | both parsers | hardening tests |
| Unified `AttestationError` with stable `code`/`level`; signature-length pre-check before curve math; strict base64url via `@scure/base` (no `btoa`/`atob`); `__proto__`-safe JSON parse; strict payload field types; `getSubMetadata()` deep copy | parsers + error model | error-table test, fuzz (~1 050 rounds), source-scan tests |
| Derivation revisions `rN` in info strings; NFKC canonicalization of names/contexts; derivation freeze until v1.0.0 | `crypto/derivation-paths.ts` | vectors (r1 byte-identity, r2 independence, NFKC rows) |
| Peer-key-bound P2P derivation (`me2em/p2p-channel/v2`) — UKS-safe | `deriveSharedSecret` | vectors + channel tests |
| No randomness in any key: all long-term keys are **derived** (HKDF), signatures are deterministic; `randomUUID` (v4, `getRandomValues` fallback) used only for `jti` | core | PR-7 tests (fallback, no-`btoa`) |
| Structural auto-init of the Ed25519 backend: single entry point (exports map), `@noble/ed25519` importable only by `crypto/init.ts` | module graph | `test/arch-cycle.spec.ts` (4-form source scan + import-order pins) |

## 5. Threats and mitigations

### 5.1 Seed or mnemonic compromise

**Impact:** total — the seed is the root of all key material (A1).
**Stance:** by design, recovering the key tree from a leaked seed is
*expected behavior*, not a vulnerability (SECURITY.md, "Security Model
Notes"). **Mitigations offered:** derivation is client-side only; the
seed is never transmitted by the library; optional BIP39 passphrase
("25th word") splits trust between mnemonic and passphrase; `@me2em/react`
keeps per-identity encrypted caches with non-extractable persisted keys.
**Residual:** physical/JSR disclosure of the mnemonic is out of protocol
reach (§6).

### 5.2 In-memory key extraction (memory scraping, heap dumps)

**Mitigations:** keys live in true `#private` fields (unreachable via
property access or casts); defensive copies on every informational
getter; `JSON.stringify` and console inspection are redacted;
`dispose()` zeroizes (`fill(0)`) and permanently revokes capabilities
(`DisposedError`); the session-bound profile keeps key material
transient by architecture.
**BL-07 limit (documented):** a JS runtime cannot *guarantee* buffer
zeroization — GC and JIT may retain copies outside the library's
control, and `fill(0)` does not pin prior heap copies. This is an
explicit, accepted platform limitation (BACKLOG BL-07), not a
vulnerability; do not build compliance claims on hard zeroization.

### 5.3 Private-key exfiltration through the API surface

**Mitigations:** the `Signer` contract (D2) means raw private keys never
appear in call arguments across a trust boundary — issuance is signed by
the issuer's own encapsulated key; `#privateKey` is a true private field
with no accessor (the RFC 8032 signature determinism doubles as the
byte-parity pin that proves the encapsulated key is the signing key);
fuzz suites assert no unexpected exception channel leaks state.

### 5.4 Attestation forgery

**Vector:** present a chain whose signatures or binding do not hold.
**Mitigations:** every link is Ed25519-signed over canonical payload
bytes; the verifier checks the root signature against the configured
`rootPublicKey`, the child signature against `A.subjectId` (the parent
key named *inside* the verified chain — no key substitution), performs a
signature-length pre-check before curve math, and decodes strict
base64url. **Residual:** none beyond the cryptographic assumptions of
§3.

### 5.5 Attestation replay

**Vector:** re-present a previously valid chain. **Mitigations:** every
attestation carries `iat`/`exp` (checked with §5.7 tolerance) and a
validated `jti`; `RevocationChecker` is consulted for the root
attestation, the handle attestation **and** the session `jti` —
revoking an attestation `jti` disables the entire branch: current and
future sessions. **Residual:** a verifier deployed **without** a
`RevocationChecker` must rely on expiry alone; within the validity
window a replay is indistinguishable from the original presentation
(this is inherent to bearer credentials). Recommendation: verifiers
facing external audiences keep a `jti` cache (README best practices).

### 5.6 Session replay

**Mitigations:** the session token is bound to the key that signed it
(verified against the public key the session claims — `hId`), carries
`iat`/`exp`/`ttl`, cannot outlive the earliest attestation expiry in its
chain, and is re-verified in full on every `verifyStateless` /
`verifyAttested` call (stateless — no server session state to
compromise). The session revocation check is the **last** step (13) of
`verifyAttested`: a revoked `jti` fails closed even if every other
property held. Renewal rotates `jti`.
**Residual:** revocation lineage across renewals needs the planned `sid`
field (BACKLOG BL-06) — today a renewed session's lineage cannot be
revoked wholesale, only its current `jti`.

### 5.7 Clock-skew exploitation

**Mechanism:** every time comparison tolerates ±30 s
(`CLOCK_SKEW_SECONDS`, pinned in specs/v1.0.md §7): `EXPIRED` is raised
only when `now > exp + 30`; `NOT_YET_VALID` only when `now < iat − 30`.
**Exploit bound:** a verifier whose clock trails true time accepts a
token up to 30 s beyond its intended expiry (and symmetrically, a
future-dated token up to 30 s early); the tolerance is applied
independently at each verification stage against the *same* verifier
clock, so it does not accumulate across stages into a longer total
extension than 30 s per check. Grant caps (`maxSessionTtl`, attestation
expiries) bound what those 30 s are worth. **Mitigations:** run
verifiers NTP-synced (the 30 s budget is an operations trade-off
between false rejects and skew tolerance, not a grace period to spend);
a `RevocationChecker` entry closes the window for any token known to be
compromised. **Residual:** the constant is fixed in the frozen v1.0
format; changing it is a spec-level decision (§8).

### 5.8 Grant escalation and delegation abuse

**Vector:** a malicious holder (5.2 capability class) tries to widen
scopes, extend TTL, add audiences, attest children beyond its grant, or
splice chains. **Mitigations:** the effective grant `G` is the
intersection of the parent attestation grant and the child claims —
violations raise `SCOPE_EXCEEDED` / `TTL_EXCEEDED` /
`AUDIENCE_NOT_PERMITTED` at level `ROOT` before any session is accepted; `subNamePatterns`
wildcards are *permitting* (a holder can do everything **inside** its
wildcard — scope the pattern narrowly); path agreement (child → parent)
and `hId == B.subjectId` make chain splicing produce signature or
binding failures; `MAX_DEPTH = 2` makes every SubHandle a leaf
(`MAX_DEPTH_EXCEEDED`) — there is no unbounded delegation depth.

### 5.9 Malicious parser input

**Vector:** hostile tokens against every decode/verify surface.
**Mitigations:** payload size is rejected **before** decoding (2048 /
4096 bytes); JSON parsing is `__proto__`-safe (reviver — hostile keys
yield `MALFORMED`, `Object.prototype` stays clean); session payload
fields are strictly type-checked before any name derivation, so
tampered tokens cannot provoke `TypeError`s; `jti` is validated for
shape and length; signatures are length-checked before curve math; the
only error type that ever escapes is `AttestationError` with a stable
`code`/`level` — pinned by deterministic seeded fuzz (~1 050 rounds over
garbage and mutated tokens) and the exhaustive error-table test.
`getSubMetadata()` returns a true deep copy, so caller-side mutation of
returned metadata cannot affect internal constraint state.

### 5.10 Resource exhaustion (parser DoS)

**Mitigations:** hard payload caps make amplification impossible before
any decode work; the chain structure accepts at most two attestations
(no recursion, no unbounded nesting); Ed25519 verification cost is
gated by the length pre-check. **Residual:** per-token verification is
inherent asymmetric-crypto work; request rate limiting belongs to the
transport layer (§6).

### 5.11 Unknown key-share on P2P derivation

**Mitigation:** shared-secret derivation binds **both** peers' public
keys into the HKDF info (`me2em/p2p-channel/v2`) — a peer cannot be
tricked into deriving a key it shares with a third party under a
different identity. The raw X25519 step remains exposed
(`crypto.rawX25519SharedSecret`) for advanced use, but the
default `deriveSharedSecret` path is UKS-safe.

### 5.12 Derivation downgrade / rollback

**Mitigation:** every derived secret carries its revision in the HKDF
info string (`me2em/secret/v1/rN`, `me2em/channel/v1/rN`); revision 1 is
byte-identical to the frozen v1.0 derivation and is pinned by golden
vectors; revisions ≥ 2 are cryptographically independent, so rotation
never silently re-derives old material; `DERIVATION_PATHS` is the single
source of truth for info strings; NFKC canonicalization removes
context-encoding ambiguity (fullwidth vs ASCII forms derive the same
secret); the derivation freeze (PLAN-LTS §4) forbids any
derivation-affecting change before v1.0.0 — the revision mechanism is
the only sanctioned evolution path.

### 5.13 Randomness failures

**Mitigation:** the core contains no random key generation — every
long-term key is derived via HKDF from the seed, and Ed25519 signatures
are deterministic (RFC 8032), which eliminates the nonce-reuse failure
class entirely. The only randomness consumed is `jti` via
`crypto.randomUUID`, which has a `getRandomValues`-based v4 fallback
(version/variant bits set) for runtimes without the API.

### 5.14 Cross-runtime portability gaps

**Mitigation:** `btoa`/`atob` are banned from `src/` by a source-scan
test (base64url comes from the audited `@scure/base` codec, byte-identical
and pinned by golden vectors); `randomUUID` has a documented fallback;
`engines.node >= 22` sets one supported Node line (A2). Portability
regressions are caught at test time, not in production.

## 6. Explicit non-goals (out of scope)

Me2eM does **not** claim protection against:

1. **Host compromise** — malware, rootkits, compromised runtimes,
   memory disclosure at the OS level. If the device is owned, everything
   on it is owned; the session-bound transient-key profile narrows the
   window but cannot eliminate it.
2. **Side channels of the JS runtime** — timing, cache, allocation and
   GC artifacts are platform properties outside the library's control.
3. **Post-quantum adversaries** — Ed25519, X25519 and HKDF-SHA256 are
   not PQ-resistant; a PQ migration is a new-revision / major-version
   undertaking (§8), not a patch.
4. **Transport-layer security** — TLS/mTLS, request rate limiting and
   network DoS below the payload caps belong to the deployment.
5. **Verifier compromise** — a verifier is trusted for its own
   decisions; integrity of its revocation store and clock is an
   operational duty (§5.7).
6. **Seed-phrase handling** — social engineering, photography of paper
   backups, cloud-synced notes (README best practices address the
   process; the protocol cannot).
7. **Wallet binding** — `subjectWallet` / Solana attribution is a
   separate design track (`@me2em/solano`), deliberately excluded from
   the core attestation format (A4).
8. **`@me2em/crypto` E2EE internals** — X3DH, pre-key and channel-layer
   threats are documented in that package's README; this document covers
   the core protocol primitives.

## 7. Accepted residual risks

| Risk | Class | Tracked |
|------|-------|---------|
| Hard buffer zeroization is impossible in JS; GC/JIT may retain key copies | Platform (BL-07) | BACKLOG BL-07 |
| Replay window for verifiers without a `RevocationChecker` | Deployment duty | README best practices |
| ±30 s skew tolerance extends acceptance past `exp` for skewed clocks | Spec constant (frozen) | §5.7 |
| Renewed session lineage cannot be revoked wholesale (no `sid` yet) | Roadmap | BACKLOG BL-06 |
| Single algorithm suite (Ed25519/HKDF-SHA256/X25519); agility = new revision or major | Protocol design | §8 |

## 8. Change discipline

- **Wire format and derivation** are frozen by
  [`specs/v1.0.md`](./specs/v1.0.md) and pinned by
  [`specs/test-vectors.json`](./specs/test-vectors.json); any change to
  an info string, payload schema or limit is a BREAKING protocol change
  requiring a new version and a vector-file revision.
- **The public API is frozen** as of `1.0.0-rc.1` (specs/v1.0.md §12):
  additive changes land in 1.x minors, breaking changes require 2.0.0
  and a new spec revision.
- **Security fixes** follow the [`SECURITY.md`](./SECURITY.md) SLA:
  critical vulnerabilities are fixed within 7 days inside the 24-month
  support window that opens at v1.0.0 GA.
