// packages/crypto/src/core/hkdf.ts
import { throwCryptoError, type CryptoErrorCode, type CryptoErrorLevel } from '../errors.js';

/**
 * Converts a Uint8Array to an ArrayBuffer with an explicit copy.
 *
 * This avoids SharedArrayBuffer edge cases and ensures the result
 * is a standalone ArrayBuffer that WebCrypto can import.
 *
 * @param bytes - The byte array to copy.
 * @returns A new ArrayBuffer containing the same bytes.
 */
function toAB(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(ab);
  view.set(bytes);
  return ab;
}

/**
 * HKDF-SHA256 per RFC 5869, implemented with the native WebCrypto
 * HKDF primitive (NOT the PBKDF2-based workaround used in some
 * libraries).
 *
 * Domain separation: all info strings in Me2em start with
 * `me2em/crypto/v1/…` — callers MUST use a unique info per purpose.
 *
 * @param ikm - Input key material (high entropy: derived from seed
 *   or another key, NOT a human password — for passwords use a
 *   password KDF like Argon2id, planned separately).
 * @param salt - Random or context salt; may be empty. Fresh salt
 *   per derivation is recommended when deriving session-scoped keys.
 * @param info - Purpose/context string.
 * @param length - Output bytes (max 255*32 = 8160).
 * @returns The derived key material of the requested length.
 * @throws {CryptoError} 'KDF/DERIVATION_FAILED' if WebCrypto fails,
 *   or length > 8160.
 *
 * @example
 * ```ts
 * const cacheKey = await hkdf(loginMaterial, freshSalt,
 *   'me2em/crypto/v1/cache-wrap', 32);
 * ```
 */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  if (length > 255 * 32) {
    throwCryptoError('DERIVATION_FAILED', 'KDF', 'length > 8160');
  }
  const base = await crypto.subtle.importKey(
    'raw',
    toAB(ikm),
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toAB(salt), info: toAB(info) },
    base,
    length * 8
  );
  return new Uint8Array(bits);
}

/**
 * String-info convenience wrapper around {@link hkdf}.
 *
 * Encodes `info` as UTF-8 before passing to hkdf.
 *
 * @param ikm - Input key material.
 * @param salt - Salt (may be empty).
 * @param info - UTF-8 string used as the info/context parameter.
 * @param length - Output bytes (max 8160).
 * @returns The derived key material.
 * @throws {CryptoError} On the same conditions as hkdf.
 *
 * @example
 * ```ts
 * const sessionKey = await hkdfWithInfo(masterSecret, salt,
 *   'me2em/crypto/v1/session-key', 32);
 * ```
 */
export async function hkdfWithInfo(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number
): Promise<Uint8Array> {
  return hkdf(ikm, salt, new TextEncoder().encode(info), length);
}
