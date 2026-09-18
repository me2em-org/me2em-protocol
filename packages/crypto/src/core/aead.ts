// packages/crypto/src/core/aead.ts
import { throwCryptoError } from '../errors.js';
import { randomBytes } from '../utils/binary.js';

/**
 * Result of AEAD encryption: ciphertext (with GCM tag appended) and IV.
 *
 * The ciphertext blob includes the 16-byte GCM authentication tag
 * as its last 16 bytes. To decrypt, pass ciphertext and iv separately.
 */
export interface AeadResult {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * Imports a raw 32-byte key as a CryptoKey for AES-GCM operations.
 *
 * @param rawKey - 32-byte AES-256 key material.
 * @returns A CryptoKey ready for encrypt/decrypt.
 * @throws {CryptoError} 'KEY/INVALID_LENGTH' if key length ≠ 32.
 *
 * @example
 * ```ts
 * const key = await importAeadKey(masterDerivedKey);
 * ```
 */
export async function importAeadKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'AES-256-GCM key must be 32 bytes');
  }
  return crypto.subtle.importKey(
    'raw',
    rawKey.buffer,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts plaintext with AES-256-GCM using the provided CryptoKey.
 *
 * Generates a fresh random IV (12 bytes) for every call — reusing
 * an IV with the same key in GCM mode catastrophically compromises
 * confidentiality.
 *
 * The returned ciphertext includes the 16-byte GCM tag as its last
 * 16 bytes; no separate authTag field is needed.
 *
 * @param key - CryptoKey imported via importAeadKey.
 * @param plaintext - The data to encrypt.
 * @returns AeadResult with ciphertext (tag included) and IV.
 * @throws {CryptoError} 'ENCRYPTION_FAILED' if WebCrypto encrypt fails.
 *
 * @example
 * ```ts
 * const { ciphertext, iv } = await encryptAead(key, secretData);
 * // store/transmit ciphertext + iv together
 * ```
 */
export async function encryptAead(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<AeadResult> {
  const iv = randomBytes(12);
  try {
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );
    return {
      ciphertext: new Uint8Array(ciphertextBuf),
      iv,
    };
  } catch (err) {
    throwCryptoError('ENCRYPTION_FAILED', 'CIPHER', `AES-GCM encrypt failed: ${err}`);
  }
}

/**
 * Decrypts AES-256-GCM ciphertext produced by {@link encryptAead}.
 *
 * Wraps WebCrypto errors in CryptoError to prevent DOMException from
 * leaking into the public API.
 *
 * @param key - CryptoKey imported via importAeadKey.
 * @param ciphertext - The ciphertext blob (includes the 16-byte GCM tag).
 * @param iv - The IV used during encryption.
 * @returns The decrypted plaintext.
 * @throws {CryptoError} 'CIPHER/DECRYPTION_FAILED' on auth failure or corrupt data.
 *
 * @example
 * ```ts
 * const plaintext = await decryptAead(key, ciphertext, iv);
 * ```
 */
export async function decryptAead(
  key: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  try {
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new Uint8Array(plaintextBuf);
  } catch (err) {
    throwCryptoError('DECRYPTION_FAILED', 'CIPHER', `AES-GCM decrypt failed: ${err}`);
  }
}
