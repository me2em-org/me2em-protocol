# `@me2em/core` — Development Backlog

Baseline: v0.6.0 · 166 tests, tsc clean.
This document is **advisory** — a recommendation list for future
development, not part of the shipped API contract.

## Workflow

- Priorities: **P1** correctness/security (next release) → **P2**
  robustness → **P3** protocol extensions (0.8+) → **P4** cosmetics.
- Statuses: `open` → `in-progress` → `done` | `declined` (with rationale).
- Closing an item: reference the commit and the test file.
- Anything touching key derivation (info strings, salts) MUST ship as a
  new versioned string (`/v2`) with a migration note — never in place.

## P1 — Correctness & Security

- **BL-01 · open · UKS binding in `deriveSharedSecret`.**
  HKDF `info` does not bind the peers' public keys → unknown key-share
  is possible (A believes the channel is with B; actually with C).
  Fix: `info = 'me2em/p2p-channel/v2' || sort([myPub, otherPub])`.
  Ship as a v2 string; add a substitution test (A↔B ≠ A↔C).
- **BL-02 · open · Fail-open `[]` in SubHandleMetadata.**
  `allowedAudiences?.length` treats `[]` as "no restrictions"; it should
  mean "deny all" (consistent with `AttestationGrant`). Change to
  `if (allowed) require includes`; keep `undefined` = unrestricted; add
  regression tests for both fields.
- **BL-03 · open · `Attestation.verifySignature` contract.**
  Returns `false` on a bad signature but **throws** on a malformed
  signature length (noble). Wrap → always boolean; document in TSDoc.
  `verifyAttested` already wraps; this fixes direct API users.
- **BL-04 · open · BIP39 passphrase ("25th word").**
  `get32ByteSeedFromMnemonic` lacks a passphrase parameter: no
  split-trust scenario (words in browser + passphrase on device), and
  importing an externally-created passphrase phrase silently derives a
  *different* identity. Add `passphrase: string = ''` (NFKC) — additive.
- **BL-05 · open · Validate `ttl` in `Session.create`.**
  `ttl: NaN` passes checks (`NaN > x === false`) → `exp: NaN` → the
  token rejects itself at verification. Enforce
  `Number.isInteger(ttl) && ttl > 0` in `validateSessionOptions`
  (polymorphic); tests for NaN / 0 / negative / fractional.

## P2 — Robustness

- **BL-06 · open · `sid` (session lineage id).**
  Renewal rotates `jti`, so a renewed session's lineage cannot be
  revoked wholesale. Add optional `sid` in the payload (random at
  creation, stable across renewals); `RevocationChecker` checks both.
  `sid` must be random (not derived from the handle) to avoid
  cross-audience linkability.
- **BL-07 · open · `destroy()` for Identity/Handle/SubHandle.**
  `fill(0)` private key bytes + `destroyed` flag; key operations throw
  afterwards. TSDoc must honestly state GC/JIT limits (copies may
  persist; non-extractable WebCrypto keys are the browser-grade
  strategy — separate track).
- **BL-08 · open · Constraints leak via `getMetadata()`.**
  The SubHandle constructor passes full `SubHandleMetadata` (including
  `allowedScopes`) into the base `_metadata`, whose TSDoc promises token
  serialization. Pass only display fields to `super`; keep constraints
  in `_subMetadata` only.
- **BL-09 · done (0.6.0) · Mode 1 constraint semantics.**
  Documented as a decision record: `verifyStateless` does not enforce
  SubHandleMetadata (advisory in Mode 1); normative enforcement is
  Mode 2 attestations. See README "Verification modes" and USE_CASES.

## P3 — Protocol Extensions (0.8+)

- **BL-10 · open · `attRef` — chain compression for narrow channels.**
  Full chain on first contact, verifier caches by `jti`, later tokens
  carry `attRef` only. Cache holds public data; loss degrades
  performance, not security. Needs attRef format + optional
  `chainCache` on the verifier.
- **BL-11 · open · Renewal window for IoT attestation rotation.**
  Verifiers accept a chain expired ≤ N days with a warning flag so a
  healthy but unmaintained device does not hard-fail. Pairs with an
  operator dashboard.
- **BL-12 · open · Root public key distribution (DID / transparency log).**
  Bootstrap of trust for third-party verifiers (drone-buyer scenario).
  Candidates: DID document or append-only transparency log.
- **BL-13 · open · Re-attestation transparency.**
  Detecting that the same identity was re-attested (e.g., HR re-issuing
  `worker-alice`). Requires an append-only attestation event log;
  depends on BL-12 infrastructure.
- **BL-14 · open · PFS for P2P channels (Noise XK/KK).**
  Static-static ECDH has no forward secrecy (documented in TSDoc).
  Optional handshake module signing ephemerals with the static key.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Convention
  for apps: prefix keys (`att:` / `sess:`) or two checkers. Document as
  convention; split interfaces only on demand.

## P4 — Cosmetics

- **BL-16 · open ·** Rename describe titles "Phase 0 …" to semantic names.
- **BL-17 · open ·** `SeedStrength` TSDoc promises 160/192/224; the type
  allows only 128|256. Align doc and type.
- **BL-18 · open ·** Replace `bPayload!` non-null assertion in
  `verifyAttested` step 11 with an explicit branch that throws.