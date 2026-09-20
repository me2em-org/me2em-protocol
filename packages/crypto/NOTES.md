# NOTES.md — Iteration D3

## Ed25519-PUBLIC → X25519-PUBLIC conversion

**API used:** `@noble/curves` `ed25519.utils.toMontgomery(pubEd)`

This function accepts both private and public Ed25519 keys and converts
them to Montgomery (X25519) form. It is available in `@noble/curves`
v1.8.1+.

Implemented as `ed25519PubToX25519()` in `src/core/ecdh.ts`, exported
from the main index.

## INVALID_ARGUMENT error code

The code `'INVALID_ARGUMENT'` already exists in `CryptoErrorCode` union
in `src/errors.ts` (line 8). No additions were needed.

Used in:
- `generateOneTimePreKeys()` — count out of range
- `generatePreKeyBatch()` — otkCount out of range
- `initiateX3DH()` — bundle missing OTK
- `publishableBundle()` — OTK index out of range

## Roundtrip test (главный ассерт)

The roundtrip test in `test/x3dh/protocol.spec.ts`:

1. Alice and Bob generate Ed25519 identity keys (proper Ed25519, not
   X25519 wrapped).
2. Bob generates SPK via `generateSignedPreKey(bobIdentity)` and an
   OTK via `generateX25519KeyPair()`.
3. A `PreKeyBundle` is constructed with Bob's identity pub, SPK pub,
   SPK sig, and OTK pub.
4. Alice calls `initiateX3DH(aliceIdentity, bundle)` → `sharedSecretA`,
   `ephemeralPublicKeyA`.
5. Bob calls `completeX3DH(bobIdentity, bobSPK, bobOTK, aliceIdentityPub,
   ephemeralPublicKeyA)` → `sharedSecretB`.
6. **ASSERT:** `sharedSecretA === sharedSecretB` (byte-for-byte equal).
