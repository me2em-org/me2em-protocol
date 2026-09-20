// packages/crypto/src/core/ecdh.ts
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { throwCryptoError } from '../errors.js';

export interface X25519KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Generates an X25519 keypair (for OTKs and ephemeral keys).
 *
 * Uses @noble/curves x25519.utils.randomSecretKey() for private key
 * generation — direct X25519, NOT an Ed25519 key converted to
 * Montgomery form.
 *
 * @returns A keypair with 32-byte privateKey and publicKey.
 *
 * @example
 * ```ts
 * const { privateKey, publicKey } = generateX25519KeyPair();
 * // privateKey is 32 random bytes
 * ```
 */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/**
 * X25519 ECDH. Returns the FULL 32-byte shared secret.
 *
 * ⚠️ Security note: some implementations truncate this output
 * (a legacy bug from typed-array workarounds) — truncation breaks
 * interoperability and MUST NOT be replicated.
 *
 * @param privateKey - 32-byte X25519 private key.
 * @param publicKey - 32-byte X25519 public key.
 * @returns 32-byte shared secret (full, NOT truncated).
 * @throws {CryptoError} 'KEY/INVALID_LENGTH' if inputs ≠ 32B.
 *
 * @example
 * ```ts
 * const shared = x25519SharedSecret(alicePriv, bobPub);
 * // shared is exactly 32 bytes
 * ```
 */
export function x25519SharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  if (privateKey.length !== 32 || publicKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'X25519 keys must be 32 bytes');
  }
  return x25519.getSharedSecret(privateKey, publicKey);
}

/**
 * Converts an Ed25519 private key to its X25519 equivalent
 * (RFC 7748 Montgomery form) — needed for identity keys, which are
 * Ed25519 in Me2em but must participate in ECDH.
 *
 * Uses @noble/curves ed25519.utils.toMontgomerySecret() for correct
 * clamping per RFC 7748 Section 5.
 *
 * @param edPrivateKey - 32-byte Ed25519 private key.
 * @returns 32-byte X25519-compatible private key.
 * @throws {CryptoError} 'KEY/INVALID_LENGTH' if input ≠ 32B.
 *
 * @example
 * ```ts
 * const xPriv = ed25519PrivToX25519(edPrivKey);
 * const xPub = deriveX25519PublicKey(xPriv);
 * ```
 */
export function ed25519PrivToX25519(edPrivateKey: Uint8Array): Uint8Array {
  if (edPrivateKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'Ed25519 private key must be 32 bytes');
  }
  return ed25519.utils.toMontgomerySecret(edPrivateKey);
}

/**
 * Derives the X25519 public key from an X25519 private key.
 *
 * @param xPriv - 32-byte X25519 private key.
 * @returns 32-byte X25519 public key.
 *
 * @example
 * ```ts
 * const pub = deriveX25519PublicKey(priv);
 * ```
 */
export function deriveX25519PublicKey(xPriv: Uint8Array): Uint8Array {
  return x25519.getPublicKey(xPriv);
}

/**
 * Converts an Ed25519 PUBLIC key to its X25519 (Montgomery) form.
 *
 * Used in X3DH to convert the recipient's identity public key
 * (Ed25519) to X25519 for ECDH operations. Uses
 * @noble/curves ed25519.utils.toMontgomery() which accepts both
 * private and public keys.
 *
 * @param edPublicKey - 32-byte Ed25519 public key.
 * @returns 32-byte X25519 public key.
 * @throws {CryptoError} 'INVALID_LENGTH' if input ≠ 32B.
 *
 * @example
 * ```ts
 * const xPub = ed25519PubToX25519(edPubKey);
 * const shared = x25519SharedSecret(ephemeralPriv, xPub);
 * ```
 */
export function ed25519PubToX25519(edPublicKey: Uint8Array): Uint8Array {
  if (edPublicKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'Ed25519 public key must be 32 bytes');
  }
  return ed25519.utils.toMontgomery(edPublicKey);
}
