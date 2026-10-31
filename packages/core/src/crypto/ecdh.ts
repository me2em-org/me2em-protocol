// packages/core/src/crypto/ecdh.ts
//
// X25519 (Montgomery) ECDH step of the P2P shared-secret derivation
// (specs/v1.0.md §3 "P2P"): both Ed25519 keypairs are converted to the
// Montgomery form (RFC 7748) and the raw X25519 output becomes the HKDF
// IKM. Isolated here (PR-10, task 3.3.1) so that no protocol module
// imports `@noble/curves` directly — every crypto primitive lives
// under `crypto/` and reaches the rest of the codebase through
// documented wrappers.

import { ed25519, x25519 } from '@noble/curves/ed25519.js';

/**
 * Computes the raw X25519 shared secret between this party's Ed25519
 * private key and the peer's Ed25519 public key (both converted to the
 * Montgomery form, RFC 7748). ECDH is symmetric, so the result is
 * order-independent — and byte-identical on both peers.
 *
 * This is only the raw ECDH output. The protocol derivation
 * ({@link Handle.deriveSharedSecret}) additionally binds both peers'
 * public keys into the HKDF salt and expands with the P2P info string;
 * never encrypt with the raw output alone.
 *
 * @param myPrivateKey - This party's 32-byte Ed25519 private key.
 * @param otherPublicKey - The peer's 32-byte Ed25519 public key.
 * @returns The 32-byte raw ECDH output — the HKDF IKM of the P2P
 *   derivation.
 * @since 0.8.0
 */
export function rawX25519SharedSecret(
  myPrivateKey: Uint8Array,
  otherPublicKey: Uint8Array
): Uint8Array {
  const montgomerySecret = ed25519.utils.toMontgomerySecret(myPrivateKey);
  const montgomeryPeer = ed25519.utils.toMontgomery(otherPublicKey);
  return x25519.getSharedSecret(montgomerySecret, montgomeryPeer);
}
