# Changelog

All notable changes to `@me2em/crypto` are documented here. The package
previously had no changelog (flagged in the PR-4 review); this file is
created as part of the PR-12 docs consolidation, retroactively covering
the shipped alpha line.

## [1.1.0-rc.1] — 2026-11-04

First minor of the frozen 1.x line: SLIP-0010 ed25519 hierarchical
key derivation, shipped as the **Ф-crypto** phase of the payment-layer
plan (Документ 2 v1.2). Purely additive — the frozen API of
1.0.0-rc.1 is unchanged, and every prior test vector still passes.
This is the crypto foundation for `@me2em/solano` (Ф3), which consumes
the `crypto.slip10` namespace and carries no SLIP implementation of
its own.

### Added
- **`slip10` namespace — SLIP-0010 ed25519, hardened-only**
  (`src/core/slip10.ts`):
  - `slip10.masterKeyFromSeed(seed)` → `{ key, chainCode }`:
    `I = HMAC-SHA512(Key = "ed25519 seed", Data = seed)`; IL is the
    master key, IR the chain code. For ed25519 any IL is valid — no
    retry loop. **Seed contract: exactly 64 bytes** — the same seed
    contract as `@me2em/core`'s `Identity.fromSeed` (64 bytes, also
    the SLIP-0010 upper bound of 512 bits); otherwise `TypeError`.
  - `slip10.deriveHardened(node, index)` — hardened-only CKDpriv:
    `I = HMAC-SHA512(Key = c_par, Data = 0x00 ‖ ser256(k_par) ‖ ser32(i))`;
    `ki = IL`, `ci = IR`; `ser32` big-endian. The index MUST carry the
    hardening bit (2³¹ ≤ i ≤ 2³² − 1) — a non-hardened index throws
    `TypeError`, because normal derivation is not defined for ed25519.
  - `slip10.derivePath(node, path)` — strict hardened grammar
    `m(/(0|[1-9][0-9]*)('│h│H))*` (no leading zeros; the bare `m` is a
    detached copy), e.g. the canonical Solana payment path
    `m/44'/501'/0'/0'`.
  - `slip10.publicKey(node)` — the 32-byte Ed25519 public key via
    `@noble/curves`; chain packages derive payment addresses from it
    (Solana: `base58(publicKey)`, no checksum) without importing
    `@noble/*` themselves.
  - All contract violations throw a bare `TypeError` (programmer
    errors), distinct from the `CryptoError` operational model.
    Returned buffers are fresh copies; inputs are never mutated.
- `@noble/hashes` is now a **direct** dependency (`^1.8.0`) —
  HMAC-SHA512 for SLIP-0010. Previously present only transitively
  (via `@noble/curves` / `@scure/bip39`); pinning the same 1.8.0 line
  keeps a single instance in the package graph. No other dependency
  changes.
- Tests: the official SLIP-0010 ed25519 Test Vectors 1 and 2
  **verbatim** (every chain, private key + chain code, byte-exact;
  TV2 through the public 64-byte contract, TV1 through the
  algorithm-level `masterKeyFromSeedRaw` over the spec-legal
  16–64-byte range) plus negatives (non-hardened indices and path
  components, seed ≠ 64 bytes, malformed paths, malformed nodes) and
  a sign/verify roundtrip pinning `publicKey` against `signRaw`.

## [1.0.0-rc.1] — 2026-11-01

Release-candidate alignment with `@me2em/core` 1.0.0-rc.1 (the
API-freeze release of the LTS program). The public API of this package
is frozen as of this version; additive changes land in 1.x minors.

### Added
- `destroyChannel(channel)` — explicit channel teardown (D4): wipes
  the root key material with the two-pass secure wipe schedule,
  clears the replay window and drops the internals. The channel
  object is permanently dead afterwards — every further operation
  (encrypt, decrypt, rotate, a repeated destroy) throws
  `INVALID_KEY`. Complements rotation: `rotateChannel` invalidates
  the old object implicitly, `destroyChannel` invalidates the given
  object on purpose (logout, conversation deletion, compromise
  response).

### Changed
- `deriveKeyArgon2id` / `verifyArgon2` NFKC-normalize the password
  before hashing/verification (consistent with `@me2em/core`
  name/context canonicalization). The same logical password in
  different Unicode forms (e.g. the ligature `ﬁ` vs `fi`, precomposed
  vs decomposed accents) now produces the SAME key. **Breaking:**
  Argon2id hashes produced before this change will not verify for
  non-canonical passwords — re-derive.
- Replay protection is now a **sliding window** (F7 — behavioral
  change). Previously a strictly-increasing sequence policy rejected
  any non-advancing sequence; now the last 1000 successfully
  decrypted sequences are remembered per channel
  (`REPLAY_WINDOW_SIZE`): duplicates inside the window are rejected
  (`REPLAY_DETECTED`), bounded out-of-order delivery is ACCEPTED,
  and sequences evicted from the window can replay again (keep
  retry buffers within the window and rotate high-volume channels).
  The window resets on rotation (fresh epoch → fresh sequence
  space); failed decrypt attempts do not consume window slots.
- `Channel` objects are immutable and brand-validated (D1, D2):
  all fields are `readonly`, the object is frozen at
  establish/rotate (mutation attempts throw in strict mode), and
  every channel API rejects impostor objects (plain look-alikes,
  spread-clones) with `INVALID_ARGUMENT` — rotated-away and
  destroyed channels keep the more precise `INVALID_KEY`.
- `usedOneTimePreKeyId` (in `WrappedKey` and `X3DHInitiationResult`) is
  now **base64url unpadded** (was standard base64 with `+/=`),
  consistent with `@me2em/core` wire formats. **Breaking:**
  envelopes produced before this change carry standard-base64 ids —
  re-wrap them. `unwrapKeyForMe` is unaffected (the id is metadata
  for the caller; it is not decoded during unwrap).
- `engines.node` floor raised to `>=22.0.0` (A2, applied workspace-wide:
  root, core, crypto, react).
- Docs: `completeX3DH`/`unwrapKeyForMe` TSDoc and the README x3dh
  section now state that OTK consumption is destructive — the
  one-time pre-key private key is wiped IN PLACE after its DH;
  reuse derives a corrupted secret silently.
- `media-chunks` (F4): tests pin the fileKey-reuse GCM danger and the
  `recordingId` domain separation; README warns that `fileKey` MUST be
  unique per file.
- `toBase64` (M6): TSDoc warning — intermediate Latin-1 string is
  immutable, safe for public data only.
- `checkPasswordLeak` (M7): TSDoc warning — password + SHA-1 hash live
  in memory until GC; fail-open is documented as advisory.

### Fixed
- `generateSecurePassword` shuffle is now **unbiased**: rejection-
  sampled Fisher-Yates with fresh random per swap (F2). The previous
  implementation took modulo-biased swap indices and reused the same
  random bytes for the first 8 characters and the shuffle. A
  statistical distribution check ships as
  `scripts/password-shuffle-bias.mjs` (runs outside CI — slow and
  statistical by nature).
- `normalizeSeedPhrase` NFKC-normalizes words (F5, consistent with
  `@me2em/core`). Fullwidth and other compatibility-form mnemonics
  validate the same as their ASCII spellings.
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
