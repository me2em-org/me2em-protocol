# `@me2em/core` — Development Backlog

Baseline: v0.7.0-alpha.1 (core 186 + react 287 tests, tsc clean,
build-docs clean). This document is **advisory** — a recommendation
list for future development, not part of the shipped API contract.

## Workflow

- Priorities: **P1** correctness/security (next release) → **P2**
  robustness → **P3** protocol extensions (0.8+) → **P4** cosmetics.
- Statuses: `open` → `in-progress` → `done` | `declined` (with rationale).
- Closing an item: reference the commit and the test file.
- Anything touching key derivation (info strings, salts) MUST ship as a
  new versioned string (`/v2`) with a migration note — never in place.
- Publishing: only from `packages/*` directories (`pnpm --filter`),
  never from the workspace root (root is `"private": true`).

## P1 — Correctness & Security

*(empty — all P1 items closed in 0.6.0-alpha.1 / 0.7.0-alpha.1)*

## P2 — Robustness & Package Strategy

- **BL-27 · open · Session-Bound Context Profile.** P2, target 0.8.
  References: BeSafeChat storage architecture (persisted non-extractable
  CryptoKey, per-identity IDB), Lubimov "Beyond Signal" (seed-recoverable
  keys, lazy activation), TZ v3.0 (epoch/GK patterns → messenger layer).

  Invariants: seed is NEVER persisted (paper + transient RAM at login
  only). Identity, Handles, SubHandles, attestations, hPK — CONSTANT
  (deterministically derived from the constant seed); only ephemeral
  materials rotate (SPK/OTK, cacheKey, session tokens).

  Login (once per cache TTL): seed → PK → challenge signature → Session;
  server supplies the registry of Handle-context names → the full tree
  is recomputed; cacheKey = HKDF(login material, fresh salt) →
  importKey(extractable: false) → persisted in IDB; cache (identity
  context, future SPK/OTK privates, chat/channel keys) encrypted under
  it; hPK and hash(PK) stay RAM-only; wipe seed/PK bytes. Warm restart:
  persisted CryptoKey loaded from IDB — no seed needed. Cache TTL
  (30–90 days, configurable) → cold login. Identity is stable forever.

  Isolation: per-identity IndexedDB (`me2em_` + hash(identityId));
  open/close lifecycle on login/logout; two-account-on-one-device test
  mandatory.

  Async messaging layer: SPK/OTK generated at login, privates in the
  encrypted cache, publics on server with TTL; replay protection via
  `used_otkeys UNIQUE(otk_pk, used_by_sender_id)`; replenishment
  threshold 50/100 — server-triggered. Groups: random GK, epoch per
  membership change, pairwise GK delivery (deriveSharedSecret; BL-14
  for FS), no history for newcomers; **epoch rotation is triggered by
  attestation revocation events**.

  Dependencies: BL-15 (revocation namespaces). Boosters: BL-14 (PFS),
  BL-12 (cross-domain verification). Implementer: `@me2em/crypto` (BL-28).

  Cache key salt policy: SaltB — cacheKey is DETERMINED by the login material (which is itself deterministic from the constant seed) with a FIXED salt. Trade-off: compromise of one cacheKey compromises all cache epochs for THIS ONE USER (not others — identityId-scoped). Accepted because the cache contains no seed or key material, only derived operational data; future sensitive additions (SPK/OTK privates, chat keys) migrate to @me2em/crypto with Argon2id protection (BL-26). Document this trade-off in TSDoc of deriveCacheKey.

- **BL-28 · open · `@me2em/crypto` package.** P2, target 0.8.
  Protocol-level E2EE mechanisms shared by all verticals — the missing
  layer between core and react. API sketch (to be finalized in a
  concept doc before implementation):

      establishChannel(myHandle, theirPubKey): Channel
      rotateChannel(channel): Channel
      deriveMessageKey(channel, sequence): Uint8Array
      preKeyManager: { generateBatch(), replenish(), loadPersisted() }

  Absorbs the session-bound profile of BL-27 (SPK/OTK management,
  fresh-per-login cacheKey, envelope patterns). Invariant: no secret
  stored plaintext in caches — everything sensitive goes under the
  persisted non-extractable cache key. Design constraints: zero new
  crypto primitives (WebCrypto + @noble via core), headless-first
  (no react imports in the core logic layer), pnpm-only toolchain.

- **BL-29 · open · `@me2em/messenger` package.** P3, target 0.9.
  First vertical: chats, groups (epoch/GK patterns from the BeSafeChat
  TZ v3.0), delivery receipts, @me2em/server integration. Pilot
  consumer: BeSafeChat. Depends on BL-28. Design note: verticals must
  keep UI logic out (src/headless/ + src/react/ layout like
  @me2em/react) so a future framework-agnostic spin-off stays cheap.

- **BL-26 · open · Argon2id in @me2em/crypto.**
  Not needed for @me2em/react identity context cache (login materialis high-entropy, HKDF sufficient). But needed for @me2em/crypto(BL-28) when password-based protection is used for sensitivematerial (SPK/OTK privates, chat keys, optional cloud-backup mode).Dependency: hash-wasm in @me2em/crypto only (NOT in @me2em/react —keep zero-deps discipline there). Target: 0.8, with BL-28.

## P3 — Protocol Extensions (0.8+)

- **BL-06 · open · `sid` (session lineage id).**
  Renewal rotates `jti`, so a renewed session's lineage cannot be
  revoked wholesale. Add optional `sid` in the payload (random at
  creation, stable across renewals); `RevocationChecker` checks both.
  `sid` must be random (not derived from the handle) to avoid
  cross-audience linkability. Higher priority once auto-renewal ships
  in @me2em/react (C3).
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
  with an operator dashboard. Relevant for `@me2em/iot` (see BL-30).
- **BL-12 · open · Root public key distribution (DID / transparency log).**
  Bootstrap of trust for third-party verifiers. Elevated relevance:
  messenger vertical + any cross-domain attestation verification.
- **BL-13 · open · Re-attestation transparency.**
  Detecting that the same identity was re-attested. Requires an
  append-only attestation event log; depends on BL-12.
- **BL-14 · open · PFS for P2P channels (Noise XK/KK).**
  Static-static ECDH has no forward secrecy. Blocks FS-grade messaging
  in @me2em/crypto; the BeSafeChat TZ per-message derivation
  (`HKDF(CK, salt=message_number)`) is a lightweight interim pattern
  inside a channel's lifetime.
- **BL-15 · open · Revocation namespaces.**
  Attestations and sessions share one `RevocationChecker`. Priority
  raised: BL-27 ties attestation revocation to group epoch rotation —
  namespace confusion there is dangerous. Convention first
  (`att:` / `sess:` prefixes), split interfaces on demand.
- **BL-20 · open · Real protocol test vectors.**
  Computed vectors for identity/handle/subhandle derivation, name
  normalization, session sign/verify, attestation determinism. Also
  covers react package flows once stable.
- **BL-21 · open · Rewrite specs/core.md against 0.7.0.**
  Implementation-independent spec: derivation formulas, canonical
  names, session/attestation formats, both verification modes,
  revocation semantics. Prerequisite for v1.0 and third-party
  implementations.
- **BL-22 · open · OpenAPI reference server spec.**
  Real flow: POST /auth/challenge, /auth/verify, /attestations,
  /backup/envelope, revocation endpoints. Do together with
  `@me2em/server`.
- **BL-30 · open · `@me2em/iot` — device-management vertical.**
  Deferred until a real enterprise pilot exists (YAGNI). Merges the
  EV-station and drone-fleet patterns (both are "managed attested
  devices": provisioning, wildcard attestations, channel keys,
  operator dashboards). Splitting later is easy; merging two separate
  packages later is expensive.

## P4 — Cosmetics

- **BL-16 · open ·** Rename describe titles "Phase 0 …" to semantic names.
- **BL-17 · open ·** `SeedStrength` TSDoc promises 160/192/224; the type
  allows only 128|256. Align doc and type.
- **BL-18 · open ·** Replace `bPayload!` non-null assertion in
  `verifyAttested` step 11 with an explicit branch that throws.
- **BL-23 · open ·** Cosmetic consistency sweep: docblock indent drift,
  stale file-header comments, unused type imports.
- **BL-24 · open ·** Audit remaining non-English comments in src/
  (Russian comment in Handle.validateSessionOptions already fixed).
- **BL-25 · done · Publish pipeline fixed.**
  Root marked `"private": true`; @me2em/core published from
  packages/core with `--tag alpha`.

## Closed — 0.6.0-alpha.1 / 0.7.0-alpha.1

BL-01 (UKS binding, commit `1d8f705`) · BL-02 (fail-closed `[]`,
commit `bdcd63e`) · BL-03 (verifySignature total, commit `5e58309`) ·
BL-04 (BIP39 passphrase, seed.spec.ts) · BL-05 (ttl validation,
commit `a83d0c6`) · BL-08 (metadata leak, extractDisplayFields) ·
BL-09 (Mode 1 semantics decision record).

## Package Roadmap (strategy)

| Layer | Package | Status |
|---|---|---|
| 0 — primitives | `@me2em/core` | ✅ alpha |
| 1 — react bindings | `@me2em/react` | 🧪 in development (C1–C3) |
| 2 — protocol mechanisms | `@me2em/crypto` | planned (BL-28, with BL-27) |
| 3 — verticals | `@me2em/messenger` | planned (BL-29) |
| 3 — verticals | `@me2em/iot` | deferred (BL-30) |
| — | `@me2em/server` | planned (reference NestJS) |

Dependency rule: strictly upward (verticals → e2ee → core); verticals
never depend on each other. Every vertical keeps UI logic in
`src/react/`, domain logic in `src/headless/`.