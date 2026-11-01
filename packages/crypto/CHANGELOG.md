# Changelog

All notable changes to `@me2em/crypto` are documented here. The package
previously had no changelog (flagged in the PR-4 review); this file is
created as part of the PR-12 docs consolidation, retroactively covering
the shipped alpha line.

## [1.0.0-rc.1] — 2026-11-01

Release-candidate alignment with `@me2em/core` 1.0.0-rc.1 (the
API-freeze release of the LTS program). The public API of this package
is frozen as of this version; additive changes land in 1.x minors.

### Changed
- `engines.node` floor raised to `>=22.0.0` (A2, applied workspace-wide:
  root, core, crypto, react).

## 0.1.0-alpha.1

Initial published alpha: canonical X3DH (OTK mandatory), signed and
one-time pre-keys, E2EE channels with epoch rotation, key envelopes,
deterministic-IV media chunk encryption, Argon2id profiles
(INTERACTIVE / SENSITIVE), BIP39 seed validation, HIBP breach check,
HKDF (RFC 5869 verified), X25519 (UKS-safe), AES-256-GCM, raw Ed25519,
secure wipe.
