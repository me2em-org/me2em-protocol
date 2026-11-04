[![npm version](https://img.shields.io/npm/v/@me2em/crypto.svg)](https://www.npmjs.com/package/@me2em/crypto)
[![License](https://img.shields.io/npm/l/@me2em/crypto.svg)](https://github.com/me2em-org/me2em-protocol/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-crypto.me2em.com-blue)](https://crypto.me2em.com)

# @me2em/crypto

Cryptographic mechanisms for the Me2eM protocol: E2EE channels, X3DH key exchange, purpose-based key derivation, and envelope patterns for offline recipients and media chunk encryption.

## Status

Release candidate. E2EE channels, X3DH, SLIP-0010 derivation, password
KDF and envelopes (key-wrapping, media chunks) are shipped.

## Security Philosophy

- **Seed never persisted.** Identity material is derived from a seed and wiped from RAM after session-bound material is computed.
- **Identity/handles are constant.** They never change across sessions or logins.
- **Ephemeral materials rotate.** Session keys, SPKs, and epoch materials are refreshed at defined rotation points to limit exposure.
- **Non-extractable CryptoKey pattern.** Persisted keys are stored as non-extractable `CryptoKey` objects (see `@me2em/react` vault for the React integration). Raw key material lives only in module-private `WeakMap` internals and is wiped at rotation.

---

## 📖 Terminology (selected)

Protocol terms are **domain-neutral**. The terms most relevant to
this package:

| Term | Definition |
|------|------------|
| **Channel** | A long-lived E2EE relationship derived from an X3DH shared secret. |
| **Ephemeral material** | TTL-bound rotating material: SPK/OTK, cache keys, session tokens. |
| **PreKeyBundle** | The public key set an initiator needs to start X3DH with an offline recipient. |
| **Envelope** | A key wrapped via X3DH for offline delivery — self-contained. |
| **Epoch** | Rotation counter for channel root keys. Messages from previous epochs are undecryptable. |

Full glossary (including Identity, Handle, Attestation, Session):
see the [repository README](https://github.com/me2em-org/me2em-protocol).

---

## Install

```sh
pnpm add @me2em/crypto
```

> 💡 This package depends on [`@me2em/core`](https://www.npmjs.com/package/@me2em/core)
> and `hash-wasm` (Argon2id). It is headless-only —
> no React imports, works in both browser and Node.js ≥ 20.
> For React hooks and seed phrase UX use
> [`@me2em/react`](https://www.npmjs.com/package/@me2em/react). All three packages are
> designed to work together — see the
> [repository README](https://github.com/me2em-org/me2em-protocol) for the full package map.

## Modules

### core/

Low-level cryptographic primitives built on WebCrypto (`crypto.subtle`).

- **hkdf** — HKDF-SHA256 per RFC 5869. All `info` strings use `me2em/crypto/v1/…` domain separation.
- **ecdh** — X25519 keypair generation, shared secret derivation, Ed25519↔X25519 conversion. Full 32B keys, UKS-safe.
- **aead** — AES-256-GCM encrypt/decrypt. Random 12-byte IV per call. Ciphertext includes the 16-byte GCM tag.
- **signatures** — Raw Ed25519 signing (`signRaw`, `verifyRaw`) for transient key material.
- **slip10** — SLIP-0010 ed25519 hierarchical derivation, **hardened-only** (`slip10` namespace): `masterKeyFromSeed` (exactly 64-byte seed — same contract as `Identity.fromSeed`), `deriveHardened` / `derivePath` (`m/44'/501'/0'/0'` grammar; a non-hardened index is a `TypeError`), `publicKey`. Verified against the official SLIP-0010 ed25519 test vectors verbatim. The foundation for chain-package wallet trees (e.g. `@me2em/solana`), which carry no SLIP implementation of their own.
- **wipe** — Secure zeroing of secret byte arrays (two-pass: random then zeros).

```ts
import { hkdfWithInfo, importAeadKey, encryptAead } from '@me2em/crypto';

const derived = await hkdfWithInfo(masterKey, salt, 'me2em/crypto/v1/session', 32);
const key = await importAeadKey(derived);
const { ciphertext, iv } = await encryptAead(key, plaintext);
```

### kdf/

Key derivation and password utilities.

- **hashIdentityMaterial** — hPK pattern: deterministic SHA-256 derivative of an identity private key, scoped by identity ID. RAM-only, never persist.
- **Argon2id** — Password-based KDF with configurable profiles (`INTERACTIVE`, `SENSITIVE`). Includes salt generation and verification. Passwords are **NFKC-normalized** before hashing (consistent with `@me2em/core` canonicalization) — hashes produced before NFKC was introduced will not verify for non-canonical passwords; re-derive.
- **Password validation** — Strength validation and HIBP (Have I Been Pwned) breach checking. `generateSecurePassword` uses an **unbiased** (rejection-sampled) Fisher-Yates shuffle; its distribution is verified by `scripts/password-shuffle-bias.mjs` (outside CI).
- **Seed validation** — BIP39 mnemonic validation and normalization with **NFKC folding** — fullwidth and other compatibility-form mnemonics validate the same as their ASCII spellings.

```ts
import { deriveKeyArgon2id, generateArgon2Salt } from '@me2em/crypto';

const salt = generateArgon2Salt('INTERACTIVE');
const result = await deriveKeyArgon2id(password, salt, 'INTERACTIVE');
// result.key → 32 bytes, result.salt → store alongside the hash
```

### x3dh/

Canonical Signal X3DH key exchange.

- **initiateX3DH** — Initiator side: derives a shared secret using the recipient's published `PreKeyBundle` (SPK + OTK). Enforces OTK consumption (no zero-fallback).
- **completeX3DH** — Recipient side: completes the same computation using persisted pre-key material.
- **SPK/OTK management** — `generateSignedPreKey`, `generateOneTimePreKeys`, `verifySignedPreKey`.
- **Envelope id format** — the `usedOneTimePreKeyId` returned by `initiateX3DH` (and carried in `WrappedKey`) is **base64url unpadded** of the OTK public key — URL-safe, consistent with `@me2em/core` wire formats. `unwrapKeyForMe` does not decode it (it is caller-facing metadata).
- **Replay guard** — OTK consumption ensures each envelope is unique.

> ⚠️ **OTK consumption is destructive.** `completeX3DH` and
> `unwrapKeyForMe` wipe `ourOneTimePreKey.keyPair.privateKey` IN PLACE
> after the DH that uses it (session-bound ephemeral-key model). An OTK
> is single-use: reusing the wiped buffer derives a corrupted secret
> SILENTLY — no error is thrown. Pass a copy if retention is needed.
> The identity and SPK private keys are never touched.

```ts
import { initiateX3DH, completeX3DH, verifySignedPreKey } from '@me2em/crypto';

const bundle = await fetchPreKeyBundle(bobId);
verifySignedPreKey(bundle, bobIdentityPub);
const result = await initiateX3DH(aliceIdentity, bundle);
// transmit result.ephemeralPublicKey to Bob
```

### channels/

Long-lived E2EE channels derived from X3DH shared secrets.

- **establishChannel** — Creates a channel with a `channelId`, initial `epoch: 0`, and per-message key derivation. The returned object is frozen (readonly fields) and brand-validated.
- **encrypt/decryptChannelMessage** — Per-message keys derived via HKDF from the root key material. Sliding-window replay protection per direction: the last 1000 decrypted sequences are remembered — duplicates are rejected (`REPLAY_DETECTED`), bounded out-of-order delivery is accepted, the window resets on rotate.
- **rotateChannel** — Epoch rotation with forward secrecy at rotation points. Derives new root material, wipes old, resets the replay window.
- **destroyChannel** — Explicit teardown: wipes the root key material, clears the replay window, drops the internals. The channel object is permanently dead afterwards (`INVALID_KEY` on every further operation).

```ts
import { establishChannel, encryptChannelMessage, decryptChannelMessage, destroyChannel } from '@me2em/crypto';

const channel = await establishChannel(sharedSecret, 'chat-42');
const msg = await encryptChannelMessage(channel, 0, plaintext);
const decrypted = await decryptChannelMessage(channel, msg);

destroyChannel(channel); // explicit teardown (logout, deletion, compromise response)
```

### envelopes/

X3DH-based key wrapping for offline recipients and deterministic media chunk encryption.

- **wrapKeyForRecipient** — Wraps a 32-byte key (group key, file key) for an offline recipient via X3DH envelope. The envelope is self-contained: includes the initiator's Ed25519 identity public key so the recipient can complete X3DH.
- **unwrapKeyForMe** — Recipient side: completes X3DH, derives the wrapping key, decrypts.
- **generateFileKey** — Random 32-byte per-file key.
- **deriveChunkNonce** — Deterministic 12-byte nonce from `(fileKey, recordingId, chunkIndex)` via HKDF. **Safety depends on `fileKey` uniqueness per file** — see the warning below.
- **encryptMediaChunk / decryptMediaChunk** — Chunk-level AES-256-GCM with deterministic IVs. No IV storage needed — IV is recoverable from the file key.

> ⚠️ **`fileKey` MUST be unique per file.** `deriveChunkNonce` is deterministic
> (no IV storage) and safe ONLY because `generateFileKey()` returns a fresh
> random 32-byte key per file. Reusing a `fileKey` with the same
> `(recordingId, chunkIndex)` reproduces the nonce under the same key —
> a catastrophic AES-GCM keystream reuse (ciphertext XOR leaks plaintext
> XOR). Never re-derive, cache-and-share, or deterministically generate a
> `fileKey` across files. Call `generateFileKey()` once per file.

```ts
import { wrapKeyForRecipient, generateFileKey, encryptMediaChunk } from '@me2em/crypto';

// Wrap a group key for a member
const wrapped = await wrapKeyForRecipient({
  keyBytes: groupKey,
  recipientBundle: memberBundle,
  myIdentity: ownerIdentity,
  contextSalt: new TextEncoder().encode(groupId),
  info: 'me2em/crypto/v1/group-key',
});

// Encrypt media chunks
const fileKey = generateFileKey();
const { encrypted, iv } = await encryptMediaChunk(fileKey, chunkData, recordingId, 0);
```

## Error Model

All errors are `CryptoError` instances with `code` and `level`:

| code | level | Meaning |
|---|---|---|
| `INVALID_LENGTH` | KEY | Wrong key/salt/IV/identity length |
| `INVALID_KEY` | KEY | Key material unusable |
| `INVALID_SALT` | KEY | Salt validation failure |
| `INVALID_IV` | CIPHER | IV length or format error |
| `INVALID_ARGUMENT` | KEY | Invalid function argument |
| `DERIVATION_FAILED` | KDF | HKDF/KDF failure |
| `ENCRYPTION_FAILED` | CIPHER | AES-GCM encrypt failure |
| `DECRYPTION_FAILED` | CIPHER | AES-GCM auth failure or corrupt data |
| `REPLAY_DETECTED` | CIPHER | Duplicate sequence within the replay window |
| `SIGNATURE_FAILED` | SIGNATURE | Ed25519 signing error |
| `VERIFICATION_FAILED` | SIGNATURE | SPK/signature verification failed |
| `UNSUPPORTED_VERSION` | FORMAT | Unknown envelope version |
| `UNSUPPORTED_ALGORITHM` | FORMAT | Unsupported cipher/curve |

```ts
import { CryptoError } from '@me2em/crypto';

try {
  await unwrapKeyForMe(params);
} catch (e) {
  if (e instanceof CryptoError) {
    console.log(e.code, e.level); // e.g. 'DECRYPTION_FAILED' / 'CIPHER'
  }
}
```

## Roadmap

- **Double Ratchet** — message-key evolution per message (window-based replay protection already shipped)
- **PreKeyStorage** — IndexedDB implementation for messenger-layer persistence
- **attRef** — Attestation reference for envelope origin verification

## Invariants

- **headless-only**: zero React imports, zero DOM specifics.
- WebCrypto (`crypto.subtle`) is the only allowed crypto API.
- Dependencies: `@me2em/core`, `hash-wasm` (Argon2id), `@noble/*` and `@scure/*` primitives.

See the [@me2em/core README](https://www.npmjs.com/package/@me2em/core) for the core package.

## License

Apache License 2.0.

© 2026 Me2eM Organization. Built for privacy, openness, and user sovereignty.
