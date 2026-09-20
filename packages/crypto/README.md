# @me2em/crypto

Cryptographic mechanisms for the Me2em protocol: E2EE channels, X3DH key exchange, purpose-based key derivation, and envelope patterns for offline recipients and media chunk encryption.

## Status

**v0.1.0-alpha.1** — envelopes (key-wrapping, media chunks) + full documentation.

## Security Philosophy

- **Seed never persisted.** Identity material is derived from a seed and wiped from RAM after session-bound material is computed.
- **Identity/handles are constant.** They never change across sessions or logins.
- **Ephemeral materials rotate.** Session keys, SPKs, and epoch materials are refreshed at defined rotation points to limit exposure.
- **Non-extractable CryptoKey pattern.** Persisted keys are stored as non-extractable `CryptoKey` objects (see `@me2em/react` vault for the React integration). Raw key material lives only in module-private `WeakMap` internals and is wiped at rotation.

## Install

```sh
pnpm add @me2em/crypto
```

## Modules

### core/

Low-level cryptographic primitives built on WebCrypto (`crypto.subtle`).

- **hkdf** — HKDF-SHA256 per RFC 5869. All `info` strings use `me2em/crypto/v1/…` domain separation.
- **ecdh** — X25519 keypair generation, shared secret derivation, Ed25519↔X25519 conversion. Full 32B keys, UKS-safe.
- **aead** — AES-256-GCM encrypt/decrypt. Random 12-byte IV per call. Ciphertext includes the 16-byte GCM tag.
- **signatures** — Raw Ed25519 signing (`signRaw`, `verifyRaw`) for transient key material.
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
- **Argon2id** — Password-based KDF with configurable profiles (`INTERACTIVE`, `SENSITIVE`). Includes salt generation and verification.
- **Password validation** — Strength validation and HIBP (Have I Been Pwned) breach checking.
- **Seed validation** — BIP39 mnemonic validation and normalization.

```ts
import { deriveKeyArgon2id, ARGON2_PROFILES } from '@me2em/crypto';

const result = await deriveKeyArgon2id(password, ARGON2_PROFILES.INTERACTIVE);
// result.key → 32 bytes, result.salt → for storage
```

### x3dh/

Canonical Signal X3DH key exchange.

- **initiateX3DH** — Initiator side: derives a shared secret using the recipient's published `PreKeyBundle` (SPK + OTK). Enforces OTK consumption (no zero-fallback).
- **completeX3DH** — Recipient side: completes the same computation using persisted pre-key material.
- **SPK/OTK management** — `generateSignedPreKey`, `generateOneTimePreKeys`, `verifySignedPreKey`.
- **Replay guard** — OTK consumption ensures each envelope is unique.

```ts
import { initiateX3DH, completeX3DH, verifySignedPreKey } from '@me2em/crypto';

const bundle = await fetchPreKeyBundle(bobId);
verifySignedPreKey(bundle, bobIdentityPub);
const result = await initiateX3DH(aliceIdentity, bundle);
// transmit result.ephemeralPublicKey to Bob
```

### channels/

Long-lived E2EE channels derived from X3DH shared secrets.

- **establishChannel** — Creates a channel with a `channelId`, initial `epoch: 0`, and per-message key derivation.
- **encrypt/decryptChannelMessage** — Per-message keys derived via HKDF from the root key material. Sequence-based replay protection per direction.
- **rotateChannel** — Epoch rotation with forward secrecy at rotation points. Derives new root material, wipes old.

```ts
import { establishChannel, encryptChannelMessage, decryptChannelMessage } from '@me2em/crypto';

const channel = await establishChannel(sharedSecret, 'chat-42');
const msg = await encryptChannelMessage(channel, 0, plaintext);
const decrypted = await decryptChannelMessage(channel, msg);
```

### envelopes/

X3DH-based key wrapping for offline recipients and deterministic media chunk encryption.

- **wrapKeyForRecipient** — Wraps a 32-byte key (group key, file key) for an offline recipient via X3DH envelope. The envelope is self-contained: includes the initiator's Ed25519 identity public key so the recipient can complete X3DH.
- **unwrapKeyForMe** — Recipient side: completes X3DH, derives the wrapping key, decrypts.
- **generateFileKey** — Random 32-byte per-file key.
- **deriveChunkNonce** — Deterministic 12-byte nonce from `(fileKey, recordingId, chunkIndex)` via HKDF. Safe because each file gets a unique key.
- **encryptMediaChunk / decryptMediaChunk** — Chunk-level AES-256-GCM with deterministic IVs. No IV storage needed — IV is recoverable from the file key.

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
| `REPLAY_DETECTED` | CIPHER | Sequence counter violation |
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

- **BL-14** — Double Ratchet (message-key evolution per message)
- **BL-14** — Window-based replay protection (beyond per-message sequence)
- **PreKeyStorage** — IndexedDB implementation for messenger-layer persistence
- **attRef** — Attestation reference for envelope origin verification

## Invariants

- **headless-only**: zero React imports, zero DOM specifics.
- WebCrypto (`crypto.subtle`) is the only allowed crypto API.
- Dependencies: `@me2em/core` (workspace), `hash-wasm` (Argon2id).

See [packages/core README](../../packages/core/README.md) for the core package.

## License

Apache License 2.0 — see [LICENSE](../../LICENSE).

© 2026 Me2em Organization. Built for privacy, openness, and user sovereignty.
