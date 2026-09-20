# Me2em Protocol — Development Backlog

Baseline: core v0.7.0-alpha.1 (186) · react v0.1.0-alpha.1 (101) ·
crypto v0.1.0-alpha.1 (151) = 438 tests. tsc/build-docs clean per package.
This document is **advisory** — a recommendation list for future
development, not part of the shipped API contract.

## Workflow

- Priorities: **P1** correctness/security (next release) → **P2**
  robustness → **P3** protocol extensions (0.8+) → **P4** cosmetics.
- Statuses: `open` → `in-progress` → `done` | `declined` (with rationale).
- Closing an item: reference the commit and the test file.
- Anything touching key derivation (info strings, salts) MUST ship as a
  new versioned string (`/v2`) with a migration note — never in place.
- Publishing: only from `packages/*` directories (`pnpm --filter`),
  never from the workspace root (root is `"private": true`).
- Versioning: independent per-package semver. Cross-package
  compatibility via workspace:* ranges at publish time.
- Spec self-sufficiency: iteration specs must be executable in a fresh
  agent session — no references to prior conversations; all context
  inline.
- Commit workflow: the agent does NOT commit; the architect reviews
  and runs the commit commands provided after acceptance.

## P1 — Correctness & Security

*(empty — closed in 0.6.0/0.7.0-alpha.1)*

## P2 — Robustness & Package Strategy

- **BL-31 · open · Replay window for channels.**
  Current protection: strictly increasing seq per direction — delayed
  out-of-order messages are rejected as replays. Window-based
  acceptance (like Signal's sliding window) allows bounded
  out-of-order delivery. Requires: window bitmap per channel,
  interaction with epoch rotation. Implementer: @me2em/crypto.
- **BL-32 · open · PreKeyStorage IDB implementation.**
  The `PreKeyStorage` contract (persisted SPK/OTK batches under the
  non-extractable cache key) is defined but only the in-memory test
  implementation exists. The IndexedDB implementation lives in the
  messenger layer or @me2em/react vault — the pattern is proven
  (IdentityContextIDBStorage). Prerequisite for the async messaging
  profile of BL-27.
- **BL-29 · open · `@me2em/messenger` package.** P3, target 0.9.
  First vertical: chats, groups (epoch/GK patterns from the BeSafeChat
  TZ v3.0), delivery receipts, @me2em/server integration. Pilot
  consumer: BeSafeChat. Depends on BL-28 (done). Design note: verticals
  must keep UI logic out (src/headless/ + src/react/ layout like
  @me2em/react) so a future framework-agnostic spin-off stays cheap.
- **BL-33 · open · Argon2id cloud-backup mode (product).**
  The primitive is done (kdf/argon2, profiles, verifyArgon2). Missing:
  the PRODUCT decision + flow (opt-in encrypted seed backup in cloud —
  the BeSafeChat Cloud Recovery mode). Requires: UI flow, envelope
  format for seed backup, recovery UX. Blocked on product priority,
  not engineering.

## P3 — Protocol Extensions (0.8+)

- **BL-06 · open · `sid` (session lineage id).**
  Renewal rotates `jti`, so a renewed session's lineage cannot be
  revoked wholesale. Add optional `sid` in the payload (random at
  creation, stable across renewals); `RevocationChecker` checks both.
  `sid` must be random (not derived from the handle) to avoid
  cross-audience linkability. Auto-renewal has shipped in @me2em/react
  (C3) — this card is now practically relevant.
- **BL-07 · open · `destroy()` for Identity/Handle/SubHandle.**
  `fill(0)` private key bytes + `destroyed` flag; key operations throw
  afterwards. TSDoc must honestly state GC/JIT limits. Partially
  superseded by the session-bound profile (BL-27: transient secrets are
  architectural), but stays relevant for the classic fromSeed flow.
- **BL-10 · open · `attRef` — chain compression for narrow channels.**
  Full chain on first contact, verifier caches by `jti`, later tokens
  carry `attRef` only. Cache holds public data; loss degrades
  performance, not security.
- **BL-11 · open · Renewal window for IoT attestation rotation.**
  Verifiers accept a chain expired ≤ N days with a warning flag. Pairs
  with an operator dashboard. Relevant for `@me2em/iot` (BL-30).
- **BL-12 · open · Root public key distribution (DID / transparency log).**
  Bootstrap of trust for third-party verifiers. Elevated relevance:
  messenger vertical + any cross-domain attestation verification.
- **BL-13 · open · Re-attestation transparency.**
  Detecting that the same identity was re-attested. Requires an
  append-only attestation event log; depends on BL-12.
- **BL-14 · open · PFS upgrade: Noise-style ratchet for channels.**
  Current channels provide FS at epoch rotation points only (per-message
  HKDF derivation is an interim pattern within an epoch). Full
  Noise-style XK/KK or Double Ratchet gives per-message FS + PCS.
  Prerequisite: channel abstraction is in place (@me2em/crypto
  channels/). This is the deepest protocol extension on the roadmap.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Priority
  raised: BL-27 ties attestation revocation to group epoch rotation —
  namespace confusion there is dangerous. Convention first
  (`att:` / `sess:` prefixes), split interfaces on demand.
- **BL-20 · open · Real protocol test vectors.**
  Computed vectors for identity/handle/subhandle derivation, name
  normalization, session sign/verify, attestation determinism — plus
  X3DH/channel vectors for @me2em/crypto (the RFC 5869 vectors already
  live in crypto tests; extend the pattern).
- **BL-21 · open · Rewrite specs/core.md against 0.7.0.**
  Implementation-independent spec: derivation formulas, canonical
  names, session/attestation formats, both verification modes,
  revocation semantics. Prerequisite for v1.0 and third-party
  implementations.
- **BL-22 · open · OpenAPI reference server spec.**
  Real flow: POST /auth/challenge, /auth/verify, /attestations,
  /backup/envelope, /prekeys/* (X3DH), revocation endpoints. Do
  together with `@me2em/server`.
- **BL-30 · open · `@me2em/iot` — device-management vertical.**
  Deferred until a real enterprise pilot exists (YAGNI). Merges the
  EV-station and drone-fleet patterns. Splitting later is easy; merging
  two separate packages later is expensive.

## P4 — Cosmetics

- **BL-16 · open ·** Rename describe titles "Phase 0 …" to semantic names.
- **BL-17 · open ·** `SeedStrength` TSDoc promises 160/192/224; the type
  allows only 128|256. Align doc and type.
- **BL-18 · open ·** Replace `bPayload!` non-null assertion in
  `verifyAttested` step 11 with an explicit branch that throws.
- **BL-23 · open ·** Cosmetic consistency sweep: docblock indent drift,
  stale file-header comments, unused type imports
  (crypto: TC1_IKM dead variable removed in D2; NFKC test comment in
  argon2.spec.ts says "passed as-is" — outdated after the NFKC fix).
- **BL-24 · open ·** Final audit of non-English comments across all
  packages (Russian comments fixed in core and react; verify crypto).
- **BL-34 · open ·** CI pipeline maintenance.DevSecOps pipeline shipped (CI1, ci-security.yml): gitleaks v3,build-and-test (Node 22, build-first, 438 tests), CodeQL v4(security-extended). Quarterly maintenance checklist:.github/workflows/README.md. Pending: lint config for root-levellegacy files (continue-on-error workaround), audit blocking policydecision, coverage thresholds (@vitest/coverage-v8 in devDeps,unused).

## Closed

**0.6.0-alpha.1:** BL-01 (UKS binding, `1d8f705`) · BL-02 (fail-closed
`[]`, `bdcd63e`) · BL-03 (verifySignature total, `5e58309`) · BL-05
(ttl validation, `a83d0c6`) · BL-08 (metadata leak,
extractDisplayFields) · BL-09 (Mode 1 semantics decision record) ·
BL-25 (publish pipeline fixed).

**0.7.0-alpha.1:** BL-04 (BIP39 passphrase, seed.spec.ts).

**crypto-0.1.0 (D1–D5):**
- **BL-26 · done · Argon2id in @me2em/crypto.** kdf/argon2 with
  INTERACTIVE/SENSITIVE profiles, verifyArgon2, NFKC normalization.
  hash-wasm dependency scoped to crypto only.
- **BL-27 · done · Session-Bound Context Profile.** Implemented across
  @me2em/crypto D1–D5: X3DH (canonical Signal §3.3, OTK mandatory,
  no zero-fallback), pre-key management (SPK signature verification,
  batch + refill threshold), channels (per-message HKDF keys, replay
  protection via strictly-increasing seq, epoch rotation with forward
  secrecy), key envelopes (self-contained, offline delivery), hPK
  pattern (hashIdentityMaterial, RAM-only). References: BeSafeChat
  storage architecture, Lubimov "Beyond Signal". Isolation and warm-
  restart patterns live in @me2em/react (IdentityContextIDBStorage).
- **BL-28 · done · `@me2em/crypto` package.** Published as
  v0.1.0-alpha.1. Final API (evolved from the sketch):
    - core: hkdf (RFC 5869 verified), x25519SharedSecret (full 32B,
      no slice-bug), aead (AES-256-GCM), signRaw, secureWipe
    - kdf: hashIdentityMaterial, Argon2id (BL-26)
    - x3dh: initiateX3DH / completeX3DH, generateSignedPreKey,
      generateOneTimePreKeys, PreKeyBundle
    - channels: establishChannel, encrypt/decryptChannelMessage
      (replay: REPLAY_DETECTED), rotateChannel (epoch FS)
    - envelopes: wrapKeyForRecipient / unwrapKeyForMe (self-contained),
      media chunk encryption (deterministic nonces)
    - validation: seed (extended SeedValidationResult), password
      (strength + HIBP fail-open)
  151 tests. Found and fixed during implementation: BeSafeChat X3DH
  deviations (swapped DH roles, slice(1) truncation, zero-fallback),
  NFKC gap in hash-wasm password handling.

## Package Roadmap (strategy)

| Layer | Package | Status |
|---|---|---|
| 0 — primitives | `@me2em/core` | ✅ alpha (0.7.0-alpha.1) |
| 1 — react bindings | `@me2em/react` | ✅ alpha (0.1.0-alpha.1) |
| 2 — protocol mechanisms | `@me2em/crypto` | ✅ alpha (0.1.0-alpha.1) |
| 3 — verticals | `@me2em/messenger` | planned (BL-29, pilot: BeSafeChat) |
| 3 — verticals | `@me2em/iot` | deferred (BL-30) |
| — | `@me2em/server` | planned (reference NestJS, with BL-22) |

Dependency rule: strictly upward (verticals → crypto → core); verticals
never depend on each other. Every vertical keeps UI logic in
`src/react/`, domain logic in `src/headless/`.