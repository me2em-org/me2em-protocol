# Changelog

## 0.7.0-alpha.1

### Added
- BIP39 passphrase support: `get32ByteSeedFromMnemonic(words, passphrase)`.
  Enables the split-trust pattern (mnemonic in one place, passphrase
  in another). Passphrase is NFKC-normalized, case-sensitive, and
  NOT recoverable.

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
