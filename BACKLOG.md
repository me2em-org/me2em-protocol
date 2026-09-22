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
  compatibility via workspace:* ranges at publish time. Changesets
  adoption planned before 1.0.
- Spec self-sufficiency: iteration specs must be executable in a fresh
  agent session — no references to prior conversations; all context
  inline.
- Commit workflow: the agent does NOT commit; the architect reviews
  and runs the commit commands provided after acceptance.
- Terminology: protocol terms are domain-neutral (root README →
  Terminology); every use case assigns its own domain interpretation.
  Normative for all READMEs, specs, and articles.

## P1 — Correctness & Security

*(empty — closed in 0.6.0/0.7.0-alpha.1)*

## P2 — Robustness, Infrastructure & Package Strategy

- **BL-31 · open · Replay window for channels.**
  Current protection: strictly increasing seq per direction — delayed
  out-of-order messages are rejected as replays. Window-based
  acceptance (like Signal's sliding window) allows bounded
  out-of-order delivery. Requires: window bitmap per channel,
  interaction with epoch rotation. Implementer: @me2em/crypto.
- **BL-32 · open · PreKeyStorage IDB implementation.**
  The `PreKeyStorage` contract (persisted SPK/OTK batches under the
  non-extractable cache key) is defined but only the in-memory test
  implementation exists. The IndexedDB implementation follows the
  proven pattern (IdentityContextIDBStorage in @me2em/react).
  Prerequisite for the async messaging profile of BL-27.
- **BL-33 · open · Argon2id cloud-backup mode (product decision).**
  The primitive is done (kdf/argon2, profiles, verifyArgon2). Missing:
  the PRODUCT decision + flow (opt-in encrypted seed backup in cloud).
  Requires: UI flow, envelope format for seed backup, recovery UX.
  Blocked on product priority, not engineering.
- **BL-34 · in-progress · CI pipeline maintenance.**
  Shipped (CI1): gitleaks v3 (org license), build-first order (fixed
  TS2307 class), CodeQL v4 security-extended, pnpm store caching,
  ubuntu-24.04 pin. Pending: lint config for root-level legacy files
  (continue-on-error workaround), audit blocking policy decision,
  coverage thresholds (@vitest/coverage-v8 in devDeps, unused),
  branch protection after 2+ stable green runs.

## P3 — Protocol Extensions (0.8+)

- **BL-29 · open · `@me2em/messenger` package.** Target 0.9.
  First vertical: chats, groups (epoch/GK patterns), delivery
  receipts, @me2em/server integration. Pilot consumer: BeSafeChat.
  Depends on BL-28 (done). Verticals keep UI logic in src/react/,
  domain logic in src/headless/.
- **BL-35 · open · Publish automation via CI.**
  Publishing is manual (`pnpm publish` per package). Add a
  release workflow: npm trusted publishing (or NPM_TOKEN secret),
  changesets-driven version bumps, per-package publish jobs with
  `--tag alpha`. Natural next step now that CI exists.
- **BL-06 · open · `sid` (session lineage id).**
  Renewal rotates `jti`, so a renewed session's lineage cannot be
  revoked wholesale. Add optional `sid` in the payload (random at
  creation, stable across renewals); `RevocationChecker` checks both.
  `sid` must be random (not derived from the handle) to avoid
  cross-audience linkability. Auto-renewal has shipped in @me2em/react
  — practically relevant now.
- **BL-07 · open · `destroy()` for Identity/Handle/SubHandle.**
  `fill(0)` private key bytes + `destroyed` flag; key operations throw
  afterwards. TSDoc must honestly state GC/JIT limits. Partially
  superseded by the session-bound profile (transient secrets are
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
  messenger vertical + cross-domain attestation verification + AI agent
  mandates (UC-1).
- **BL-13 · open · Re-attestation transparency.**
  Detecting that the same identity was re-attested. Requires an
  append-only attestation event log; depends on BL-12.
- **BL-14 · open · PFS upgrade: Noise-style ratchet for channels.**
  Current channels provide FS at epoch rotation points only (per-message
  HKDF derivation is an interim pattern within an epoch). Full
  Noise-style XK/KK or Double Ratchet gives per-message FS + PCS.
  Channel abstraction is in place (@me2em/crypto channels/) — this is
  the deepest protocol extension on the roadmap.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Priority
  raised: BL-27 ties attestation revocation to group epoch rotation —
  namespace confusion there is dangerous. Convention first
  (`att:` / `sess:` prefixes), split interfaces on demand.
- **BL-20 · open · Real protocol test vectors.**
  Computed vectors for identity/handle/subhandle derivation, name
  normalization, session sign/verify, attestation determinism — plus
  X3DH/channel vectors for @me2em/crypto (RFC 5869 vectors already
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
  stale file-header comments, unused type imports; argon2.spec.ts NFKC
  test comment outdated ("passed as-is") after the NFKC fix.
- **BL-24 · open ·** Final audit of non-English comments across all
  packages (core and react fixed; verify crypto).
- **BL-24 · open ·** Create security@me2em.com Read:SECURITY.md

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
  pattern (hashIdentityMaterial, RAM-only). References: Lubimov
  "Beyond Signal", BeSafeChat storage architecture. Isolation and
  warm-restart patterns live in @me2em/react
  (IdentityContextIDBStorage).
- **BL-28 · done · `@me2em/crypto` package.** Published as
  v0.1.0-alpha.1. Final API (evolved from the sketch):
  core (hkdf RFC-verified, x25519SharedSecret full 32B, aead,
  signRaw, secureWipe) · kdf (hashIdentityMaterial, Argon2id) ·
  x3dh (initiateX3DH/completeX3DH, SPK/OTK management, PreKeyBundle) ·
  channels (establish/encrypt/decrypt with REPLAY_DETECTED, rotate
  with epoch FS) · envelopes (wrapKeyForRecipient/unwrapKeyForMe,
  deterministic-IV media chunks) · validation (extended
  SeedValidationResult, password strength + HIBP).
  151 tests. Found and fixed during implementation: BeSafeChat X3DH
  deviations (swapped DH roles, slice(1) truncation, zero-fallback),
  NFKC gap in hash-wasm password handling.

## Decision Records

- **DR-1 (0.7.0)** — Terminology standard: protocol terms are
  domain-neutral; domain interpretations per use case. Normative
  glossary lives in root README → Terminology. Terms "Session-Bound
  Identity" and "Non-persistent private key" REJECTED as misleading
  (identity is constant, not session-bound; keys are computed, not
  stored) → adopted: **Seed-Derived Identity**, **Transient/Ephemeral
  material**.
- **DR-2 (crypto-0.1.0)** — Documentation use cases approved: UC-1
  AI Agent Delegation, UC-2 IoT Device Hierarchy, UC-3 Multi-Context
  Identity. USE_CASES.md restructured accordingly (EV/Drone → UC-2,
  Corporate Messenger → UC-3, AI Agent → UC-1 added). Examples never
  mix domains.
- **DR-3 (crypto-0.1.0)** — X3DH implemented canonical per Signal
  spec §3.3: EK in DH2/DH3/DH4, OTK mandatory on both sides,
  zero-fallback prohibited. Deviations found in earlier code
  (swapped roles, zero-fallback) documented as anti-patterns.

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