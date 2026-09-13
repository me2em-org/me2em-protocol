# Changelog

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
