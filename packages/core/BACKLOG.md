# `@me2em/core` — Development Backlog

Baseline: v0.6.0-alpha.1 · 178 tests, tsc clean, build-docs clean.
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

- **BL-01 · done (0.6.0-alpha.1) · UKS binding in `deriveSharedSecret`.**
  Peers' public keys are bound into the KDF as sorted salt +
  `me2em/p2p-channel/v2` info string. Commit `1d8f705`;
  substitution test in `session.spec.ts` (A↔B ≠ A↔C, order-independent).
- **BL-02 · done (0.6.0-alpha.1) · Fail-open `[]` in SubHandleMetadata.**
  Empty arrays now deny all; `undefined` = unrestricted (consistent with
  `AttestationGrant`). Commit `bdcd63e`; regression tests in
  `subhandle.spec.ts`.
- **BL-03 · done (0.6.0-alpha.1) · `Attestation.verifySignature` contract.**
  Wrapped in try/catch → always boolean; TSDoc updated. Commit `5e58309`;
  tests: short-sig → false + MALFORMED propagation pin in
  `attestation.spec.ts`.
- **BL-05 · done (0.6.0-alpha.1) · Validate `ttl` in `Session.create`.**
  Positive-integer enforcement (NaN/0/negative/fractional/Infinity
  rejected at creation). Commit `a83d0c6`; `it.each` tests in
  `session.spec.ts`.
- **BL-04 · open · BIP39 passphrase ("25th word").**
  `get32ByteSeedFromMnemonic` lacks a passphrase parameter: no
  split-trust scenario (words in browser + passphrase on device), and
  importing an externally-created passphrase phrase silently derives a
  *different* identity. Add `passphrase: string = ''` (NFKC) — additive.
  **Target: 0.7.0.**

## P2 — Robustness

- **BL-08 · open · Constraints leak via `getMetadata()`.**
  The SubHandle constructor passes full `SubHandleMetadata` (including
  `allowedScopes`) into the base `_metadata`, whose TSDoc promises token
  serialization. Pass only display fields to `super`; keep constraints
  in `_subMetadata` only. **Target: 0.7.0.**
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
  Natural follow-up to BL-01 v2 binding.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Convention
  for apps: prefix keys (`att:` / `sess:`) or two checkers. Document as
  convention; split interfaces only on demand.
- **BL-19 · in-progress · Decide the fate of the public crypto namespace.**
  DONE: ed25519 wrappers now own their docs (real functions, 0 typedoc
  warnings). OPEN: keep/drop the namespace in the barrel — decide before
  1.0. Options: (a) keep and own, (b) `@internal` + excludeInternal,
  (c) drop re-exports. Internal code does not use them.
- **BL-20 · open · Real protocol test vectors.**
  Replace placeholder `specs/draft/test-vectors.json` with computed
  vectors: identity/handle/subhandle derivation (fixed seeds), name
  normalization cases (NFKC, separators), session sign/verify,
  attestation determinism. Source of truth: the test suite; vectors
  generated by a script to avoid hand-computed bytes.
- **BL-21 · open · Rewrite specs/core.md against 0.6.0.**
  Current draft describes pre-attestation architecture (registry lookup,
  server-issued sessions). Target: implementation-independent protocol
  spec — derivation formulas, canonical names, session/attestation token
  formats, both verification modes, revocation semantics. Prerequisite
  for third-party implementations and v1.0.
- **BL-22 · open · OpenAPI reference server spec.**
  Expand the draft to the real flow: POST /auth/challenge,
  POST /auth/verify (client-signed sessions), POST /attestations
  (issuance metadata), revocation endpoints. Do together with
  `@me2em/server`.

## P4 — Cosmetics

- **BL-16 · open ·** Rename describe titles "Phase 0 …" to semantic names.
- **BL-17 · open ·** `SeedStrength` TSDoc promises 160/192/224; the type
  allows only 128|256. Align doc and type.
- **BL-18 · open ·** Replace `bPayload!` non-null assertion in
  `verifyAttested` step 11 with an explicit branch that throws.
- **BL-23 · open ·** Cosmetic consistency sweep: truthiness pattern in
  `getSubMetadata()` (→ `!== undefined`), docblock indent drift in
  `attestHandle`/`attestSubHandle`/`verifyAttested`, file-header comments
  referencing old test paths (`// test/attestation.test.ts`), helper
  TSDoc clarifying sync-vs-async throw semantics
  (`expectAttestationErrorSync` is for sync throwers only).
- **BL-24 · open ·** Russian comment in `Handle.validateSessionOptions`
  was translated; audit remaining non-English comments in src/.