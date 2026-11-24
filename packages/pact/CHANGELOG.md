# Changelog

## [1.0.0-rc.2] — 2026-11-24

Audit-driven hardening pass over rc.1. The external audit claimed 8
blockers; each finding was verified against the code and the normative
documents (docs/PACTS.md, specs/tz-pact.md): 6 confirmed (with
corrections), 3 rejected as misquotes — see `specs/plan-pact-rc2.md`
for the full verdict table.

### Fixed (security)
- **Б1** — assembly no longer defends against skew, per ТЗ §3.4 (the
  rc.1 code contradicted it): `verifyJournal(events, clock?, opts)` with
  `{ skewCheck: 'all' | 'none' }` (default `'all'`); `finalize`
  re-verifies the extended journal with `'none'`. Assembling onto a
  historical journal with the system clock now works; the shifted-clock
  event is still rejected — by `verifyJournal` (`SKEW`), which owns C3.
- **Б5** — pinned invite mode (D13) is enforced (rc.1 validated `im`
  in the codec but the machine ignored it): `INVITE.ep?` — b64url(32)
  pactPub of the invitee; a pinned constitution rejects an `ep`-less
  INVITE (`MALFORMED`); ENROLL by another key ⇒ `INVALID_QUORUM`;
  `bearer` + `ep` — per-invite pinning. Normative: PACTS §5/§7.3/D13.
- **Б6** — voucher chains must be alive at the act:
  `iat ≤ act.iat < exp` for every attestation, else `IDP_UNRESOLVABLE`
  (rc.1 accepted expired chains). Normative: PACTS §5.4.

### Fixed (correctness / quality)
- **Б4** — fixtures: the handle voucher chain is now the real
  `[root→handle, handle self]` pair with differing issuers
  (`crypto.deriveHandleKey`); new `Member.handle()` factory — pact key
  derived from the handle key (D2). rc.1 fixtures issued both
  attestations from the anchor key (two self-attestations).
- **Б7** — `ReferenceX3DH` uses the strict codec `b64urlDecode`
  (canonical, length-pinned) instead of a lenient local decoder.
- **Б8** — fixtures: `Member.signEvent(raw, gen)` derives `p` from the
  same `gen` as the signature (was: `p` of `this.gen`).
- **В2** — early `signerKeys` length checks in assembleRotate (2),
  assembleExit/assembleEnroll (1), assembleDissolve (≥1) —
  `MALFORMED @ assemble` before building.
- **В4** — `finalize` never throws `undefined` (fallback error).
- **В12** — `ReferenceX3DH.genesis` rejects a pre-co-signed GENESIS
  (exactly one authority signature required).

### Rejected audit findings (no code change)
- **Б3** — `pactRoot` stays evHash(GENESIS) per PACTS §2 (the audit
  misquoted a non-existent §7.5 roster-hash definition); roster-fingerprint
  is a separate future concern (BL-12/F8).
- **В1** — `ft` sorting is already enforced fail-closed by the codec
  (strict-parse, PACTS §7.3); silent normalization rejected.
- **В3** — `doc↔dh` check-verification already lives in the codec and
  is covered by tests; an assembler-level duplicate rejected.

### Docs
- PACTS.md: §5 pinned-invite rule, §5.4 chain-liveness, §7.3 `INVITE.ep`,
  D13 (pinned mechanics).
- specs/tz-pact.md: `verifyJournal` opts, `verifyAct`/`verifyPrefix`
  clock parameters, Tier-3 liveness step, assembly complexity note (Б2).
- README: Limitations (v0.1) section; BACKLOG: rc.2 follow-ups.

### Tests (post-review follow-up, З2/З3)
- Assembler-level pinned-`ep` test: `assembleInvite` with `ep`
  verifies clean, and an `ep`-less pinned invite is refused **at the
  builder too** (B-7: `finalize` re-verifies the extended journal, so
  D13 violations fail closed at assembly, not only on replay).
- Liveness edge-case pin: a chain expiring exactly at `act.iat`
  (`exp = act.iat`) rejects — aliveness is strict `act.iat < exp`,
  not `≤ exp`.

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
