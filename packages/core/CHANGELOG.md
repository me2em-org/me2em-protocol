# Changelog

## [Unreleased] → will ship in 0.8.0

### BREAKING
- **Seed = 64 bytes (BIP39), D1.** `get32ByteSeedFromMnemonic` is replaced by
  `get64ByteSeedFromMnemonic`, which returns the full 64-byte BIP39 seed
  (PBKDF2-HMAC-SHA512 output) without the previous SHA-256 post-hashing.
  `Identity.fromSeed` now accepts 64 raw bytes or a 128-character hex string;
  a 32-byte / 64-hex seed throws `Invalid seed: must be 64 bytes`.
  HKDF info strings are unchanged — only the input key material changes.
  **All identities, handles, passwords, channel keys and shared secrets
  derived from a mnemonic change.** Re-derive the seed via the new function
  and re-issue attestations/sessions. There are no compatibility shims and
  no migration guide (no-compatibility mandate): this record and the
  CHANGELOG are the history.
- Removed the undocumented SHA-256(`seed64`) reduction step. It was a
  nonstandard deviation from BIP39: identities derived here could not be
  reproduced from the same mnemonic in any BIP39-compatible tooling.
  Ed25519 keys are now derived by HKDF-SHA256 directly from the 64-byte
  standard seed.

### Added
- Official BIP39 test vectors in `test/seed.spec.ts` (12-word and 24-word
  mnemonics, empty and non-empty passphrase), cross-verified against an
  independent PBKDF2-HMAC-SHA512 implementation.
- 12-vs-24-word seed equivalence tests: both strengths produce a 64-byte
  seed; different strengths derive different (but deterministic) identities.

### Fixed
- `index.ts` module JSDoc example passed a mnemonic string directly to
  `Identity.fromSeed` (would throw at runtime); the example now derives
  the seed first.

## 0.7.0-alpha.2

### Fixed
- The `wordlist` export announced in 0.7.0-alpha.1 was missing from the
  published artifact — consumer builds failed with
  `[MISSING_EXPORT] "wordlist"`. The re-export from
  `@scure/bip39/wordlists/english` (official 2048-entry list) is now
  verifiably present in `dist/`.

### Dependencies
- Added `@scure/bip39: ^1.3.0` to `dependencies` so the `wordlist`
  re-export resolves for consumers.

## 0.7.0-alpha.1

### Added
- BIP39 passphrase support: `get32ByteSeedFromMnemonic(words, passphrase)`.
  Enables the split-trust pattern (mnemonic in one place, passphrase
  in another). Passphrase is NFKC-normalized, case-sensitive, and
  NOT recoverable.
- Exported BIP39 English wordlist (`wordlist`) from `@me2em/core` for
  consumer components that need to validate user input against the
  official 2048-entry list.

### Changed
- `SubHandle.getMetadata()` no longer exposes constraint fields
  (`allowedAudiences`, `allowedScopes`, `maxSessionTtl`, `expiresAt`).
  Use `getSubMetadata()` for constraints. (Minor: fields were
  leaking into a layer documented as serializable.)

### Fixed
- Cosmetic consistency: docblock indentation, test suite titles,
  helper documentation, mixed-language comments.

## 0.6.0-alpha.1

### BREAKING
- `Handle.deriveSharedSecret` now derives channel keys with both
  peers' public keys bound into the KDF (`me2em/p2p-channel/v2`).
  Secrets derived with the previous version are NOT compatible.
  This prevents unknown key-share attacks. Migrate by re-deriving
  shared secrets on both sides after upgrade.
- Empty `allowedAudiences`/`allowedScopes` arrays in
  `SubHandleMetadata` now DENY ALL instead of allowing everything
  (consistent with `AttestationGrant`). Use `undefined` for
  "unrestricted".

### Fixed
- `Attestation.verifySignature` returns `false` (instead of
  throwing) on malformed signature lengths.
- `Session.create` validates `ttl`: must be a positive integer;
  NaN/0/negative/fractional values throw at creation instead of
  producing self-rejecting tokens.
