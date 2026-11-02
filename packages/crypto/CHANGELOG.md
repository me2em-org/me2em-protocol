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
- Docs: `completeX3DH`/`unwrapKeyForMe` TSDoc and the README x3dh
  section now state that OTK consumption is destructive — the
  one-time pre-key private key is wiped IN PLACE after its DH;
  reuse derives a corrupted secret silently.

### Fixed
- Memory hygiene on error paths (internal buffers only — no API
  change): `wrapKeyForRecipient`/`unwrapKeyForMe` wipe the X3DH shared
  secret and the derived wrapping key on EVERY exit path (previously
  wiped on the happy path only — an encrypt/decrypt failure leaked
  live key bytes, and the shared secret was never wiped);
  `initiateX3DH`/`completeX3DH` wipe all DH intermediates, the IKM,
  the derived Montgomery copy of the identity key and the ephemeral
  private key on all paths; `establishChannel` wipes the
  `sharedSecret ‖ salt` buffer; per-message key bytes are wiped right
  after `importKey`; `rotateChannel` wipes the fresh root material if
  the internals hand-off fails.

## 0.1.0-alpha.1

Initial published alpha: canonical X3DH (OTK mandatory), signed and
one-time pre-keys, E2EE channels with epoch rotation, key envelopes,
deterministic-IV media chunk encryption, Argon2id profiles
(INTERACTIVE / SENSITIVE), BIP39 seed validation, HIBP breach check,
HKDF (RFC 5869 verified), X25519 (UKS-safe), AES-256-GCM, raw Ed25519,
secure wipe.
