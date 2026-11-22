# @me2em/pact

Horizontal trust primitive for the Me2eM authorization protocol: signed
agreements between independent Identities without merging trust roots.

- **Deterministic Pact Keys** — HKDF `me2em/pact/v1/{pid}/{ch}/g{gen}` from the
  anchor node's private key (identity / handle / subhandle).
- **Append-only Pact Journal** — 11 event types, `evHash` chaining,
  `FORK_DETECTED` on optimistic CAS-append.
- **Tier 1+2+3 verification** — signatures (eternal offline), roster replay,
  dated revocation via `RevocationChecker.isRevokedAt` (`@me2em/core` rc.9).
- **2-party co-sign assembly** (v0.1) with a generic N-party verifier.
- **Byte-exact export/import** (sneakernet is a first-class mode, D47) and
  injected transport (`Channel`).

Normative base: `docs/PACTS.md` (D1–D47); implementable spec:
`specs/tz-pact.md` (v1.0, rev. 2). Depends on `@me2em/core >=1.0.0-rc.9`
(JCS RFC 8785 + `isRevokedAt`); transport is injected; `@me2em/crypto` is an
optional peer used only by the reference X3DH channel adapter.
