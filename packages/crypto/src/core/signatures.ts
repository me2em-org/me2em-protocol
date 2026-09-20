// packages/crypto/src/core/signatures.ts
import { ed25519 } from '@noble/curves/ed25519.js';
import { throwCryptoError } from '../errors.js';
import { toBase64, fromBase64 } from '../utils/binary.js';

/**
 * Raw Ed25519 signing for TRANSIENT key material.
 *
 * Use case: pre-key signatures and login challenges, where keys
 * exist as raw bytes (before wipe) and are NOT wrapped in Handle
 * objects. For identity/handle operations use @me2em/core's
 * Handle.sign instead.
 *
 * The caller MUST wipe privateKey after use (see secureWipe).
 *
 * @param privateKey - 32-byte Ed25519 private key.
 * @param message - The message bytes to sign.
 * @returns 64-byte Ed25519 signature.
 * @throws {CryptoError} 'SIGNATURE_FAILED' if key length ≠ 32.
 *
 * @example
 * ```ts
 * const sig = signRaw(privateKey, message);
 * secureWipe(privateKey); // done with the key
 * ```
 */
export function signRaw(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'SIGNATURE', 'Ed25519 private key must be 32 bytes');
  }
  return ed25519.sign(message, privateKey);
}

/**
 * Verifies a raw Ed25519 signature.
 *
 * Returns false on ANY error (malformed signature, wrong key length,
 * cryptographic mismatch) — this is a total function.
 *
 * @param publicKey - 32-byte Ed25519 public key.
 * @param message - The original message bytes.
 * @param signature - The 64-byte signature to verify.
 * @returns true if valid, false otherwise (never throws).
 *
 * @example
 * ```ts
 * if (verifyRaw(pubKey, message, sig)) {
 *   // authentic
 * }
 * ```
 */
export function verifyRaw(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Signs a message and returns the signature as a Base64 string.
 *
 * Convenience wrapper around {@link signRaw} + {@link toBase64}.
 *
 * @param privateKey - 32-byte Ed25519 private key.
 * @param message - The message bytes to sign.
 * @returns Base64-encoded 64-byte signature.
 * @throws {CryptoError} 'SIGNATURE_FAILED' if key length ≠ 32.
 *
 * @example
 * ```ts
 * const sigB64 = signRawToBase64(privKey, data);
 * ```
 */
export function signRawToBase64(
  privateKey: Uint8Array,
  message: Uint8Array
): string {
  return toBase64(signRaw(privateKey, message));
}

/**
 * Verifies a Base64-encoded Ed25519 signature.
 *
 * Convenience wrapper around {@link fromBase64} + {@link verifyRaw}.
 *
 * @param publicKey - 32-byte Ed25519 public key.
 * @param message - The original message bytes.
 * @param sigB64 - Base64-encoded signature.
 * @returns true if valid, false otherwise (never throws).
 *
 * @example
 * ```ts
 * if (verifyRawFromBase64(pubKey, data, sigB64)) {
 *   // authentic
 * }
 * ```
 */
export function verifyRawFromBase64(
  publicKey: Uint8Array,
  message: Uint8Array,
  sigB64: string
): boolean {
  return verifyRaw(publicKey, message, fromBase64(sigB64));
}
