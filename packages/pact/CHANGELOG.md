# Changelog

## [1.0.0-rc.1] — 2026-11-22

First release candidate of the horizontal trust primitive (BL-58,
M1.0–M1.7 per specs/tz-pact.md §7).

### Added
- **Deterministic Pact Keys** (`derive.ts`) — HKDF-SHA256
  `me2em/pact/v1/{pid}/{ch}/g{gen}` from the anchor node's raw private
  key; golden vectors cross-checked against node:crypto (§6.2).
- **Strict wire codec** (`codec.ts`) — JCS (RFC 8785 via core rc.9)
  + b64url + per-type payload tables (PACTS §7.3), D35 limits
  (4096/2048/16/64/256/32), D34 check-verification (`cx↔ch`, `doc↔dh`),
  `tbsBytes`/`evHash` (D32), `ZERO32`.
- **Verification** (`verify.ts`) — `verifyJournal`/`verifyPrefix`
  (sync, Tier 1+2), `verifyAct` (async, Tier 1+2+3): voucher chains
  keyed by membership id (hash-commit D34), `isRevokedAt` dated
  lookups (core rc.9), compromise windows `compromisedAt`/D20,
  warnings Р10; the full §7.7 verification order.
- **2-party assembly** (`assemble/`) — all 11 event types, B-7
  fail-closed (each builder re-verifies the extended journal), clock
  injection per Р4.
- **Storage** (`store/`) — `JournalStore` CAS-append contract
  (⇒ `FORK_DETECTED`), `MemoryStore`, `exportJournal`/`importJournal`
  byte-exact with signature sets preserved (B-8/Р8).
- **Transport** (`transport/`) — `Channel` interface, `ReferenceX3DH`
  real-crypto loopback adapter (optional peer `@me2em/crypto`).
- **Testing fixtures** (`testing/fixtures.ts`) — deterministic
  members, journal builder, real voucher chains for integrations.
- **Vectors** — `specs/test-vectors.json` section `pact`: derivation
  (incl. negative `ch`), envelope, replay lifecycle, export.

### Notes
- Peer: `@me2em/core >=1.0.0-rc.9` (JCS + `isRevokedAt`, P0.8);
  `@me2em/crypto >=1.1.0-rc.2` optional (transport only, B2).
- 91-test suite green; coverage ≥ 90% thresholds; Node 22+.
