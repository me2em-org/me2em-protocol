// packages/crypto/src/envelopes/media-chunks.ts

import { hkdfWithInfo } from '../core/hkdf.js';
import { importAeadKey } from '../core/aead.js';
import { randomBytes } from '../utils/binary.js';
import { throwCryptoError } from '../errors.js';

/**
 * Generates a cryptographically random 32-byte file key.
 *
 * @returns 32 random bytes to be used as the per-file AES-256 key.
 *
 * @example
 * ```ts
 * const fileKey = generateFileKey();
 * // use with encryptMediaChunk / wrapKeyForRecipient
 * ```
 */
export function generateFileKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Derives a deterministic 12-byte nonce for a media chunk.
 *
 * ─────────────────────────────────────────────────────────────
 * Security constraint (CRITICAL)
 * ─────────────────────────────────────────────────────────────
 *
 * Deterministic nonces are SAFE only because the fileKey is
 * UNIQUE per file (generated via generateFileKey) and the
 * (fileKey, chunkIndex) pair never repeats with the same key.
 * NEVER reuse a fileKey across files — that would produce
 * identical nonce sequences and catastrophically break GCM.
 *
 * @param fileKeyRaw - The 32-byte per-file key (from generateFileKey).
 * @param recordingId - Application-level recording/file identifier.
 * @param chunkIndex - Sequential chunk index (0-based).
 * @returns 12-byte deterministic IV/nonce.
 *
 * @example
 * ```ts
 * const nonce = await deriveChunkNonce(fileKey, 'rec-42', 0);
 * // use nonce directly with crypto.subtle.encrypt for AES-GCM
 * ```
 */
export async function deriveChunkNonce(
  fileKeyRaw: Uint8Array,
  recordingId: string,
  chunkIndex: number
): Promise<Uint8Array> {
  const info = `me2em/crypto/v1/chunk:${chunkIndex}`;
  return hkdfWithInfo(fileKeyRaw, new TextEncoder().encode(recordingId), info, 12);
}

/**
 * Encrypts a single media chunk with a deterministic IV derived
 * from the file key, recording ID, and chunk index.
 *
 * Uses direct WebCrypto `crypto.subtle.encrypt` with the
 * deterministic nonce so that the decrypting side can recover
 * the IV without storing it separately.
 *
 * @param fileKeyRaw - The 32-byte per-file key.
 * @param chunk - The chunk data to encrypt.
 * @param recordingId - Recording/file identifier for domain separation.
 * @param chunkIndex - Sequential chunk index (0-based).
 * @returns Object with encrypted ciphertext (includes GCM tag) and IV.
 *
 * @example
 * ```ts
 * const { encrypted, iv } = await encryptMediaChunk(fileKey, chunkData, 'rec-42', 0);
 * // store encrypted + iv; IV is recoverable via deriveChunkNonce
 * ```
 */
export async function encryptMediaChunk(
  fileKeyRaw: Uint8Array,
  chunk: Uint8Array,
  recordingId: string,
  chunkIndex: number
): Promise<{ encrypted: Uint8Array; iv: Uint8Array }> {
  const iv = await deriveChunkNonce(fileKeyRaw, recordingId, chunkIndex);
  const aeadKey = await importAeadKey(fileKeyRaw);
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aeadKey,
    chunk
  );
  return {
    encrypted: new Uint8Array(encryptedBuf),
    iv,
  };
}

/**
 * Decrypts a single media chunk. Recovers the deterministic IV
 * from the file key, recording ID, and chunk index, then decrypts.
 *
 * @param encryptedChunk - The ciphertext (includes GCM tag).
 * @param fileKeyRaw - The 32-byte per-file key.
 * @param recordingId - Same recording ID used during encryption.
 * @param chunkIndex - Same chunk index used during encryption.
 * @returns The decrypted plaintext.
 * @throws {CryptoError} 'DECRYPTION_FAILED' on auth failure or corrupt data.
 *
 * @example
 * ```ts
 * const plaintext = await decryptMediaChunk(encrypted, fileKey, 'rec-42', 0);
 * ```
 */
export async function decryptMediaChunk(
  encryptedChunk: Uint8Array,
  fileKeyRaw: Uint8Array,
  recordingId: string,
  chunkIndex: number
): Promise<Uint8Array> {
  const iv = await deriveChunkNonce(fileKeyRaw, recordingId, chunkIndex);
  const aeadKey = await importAeadKey(fileKeyRaw);
  try {
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aeadKey,
      encryptedChunk
    );
    return new Uint8Array(plaintextBuf);
  } catch (err) {
    throwCryptoError('DECRYPTION_FAILED', 'CIPHER', `AES-GCM decrypt failed: ${err}`);
  }
}
