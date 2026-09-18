# @me2em/crypto

Cryptographic mechanisms for the Me2em protocol.

## Status

**v0.1.0-alpha.1** — skeleton + core primitives.

## Install

```sh
pnpm add @me2em/crypto
```

## What's inside

| Module | Description |
|---|---|
| `hkdf` | HKDF-SHA256 via WebCrypto (RFC 5869) |
| `ecdh` | X25519 keypair generation, shared secret, Ed25519→X25519 conversion |
| `aead` | AES-256-GCM encrypt/decrypt with random IV |
| `signatures` | Raw Ed25519 signing for transient key material |
| `wipe` | Secure zeroing of secret byte arrays |
| `hash-identity` | `hashIdentityMaterial` — session-bound hPK derivation root |
| `binary` | Base64/hex encoding, concat, random bytes, constant-time compare |

## Roadmap

Upcoming iterations (BL-28, D2–D5):

- X3DH key exchange
- Channel establishment
- Envelope serialization
- Argon2id password KDF

## Invariants

- **headless-only**: zero React imports, zero DOM specifics.
- WebCrypto (`crypto.subtle`) is the only allowed crypto API.
- Dependencies: `@me2em/core` (workspace). `@noble/curves` + `@noble/hashes` for curve operations.

See [packages/core README](../../packages/core/README.md) for the core package.
