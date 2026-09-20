// packages/crypto/test/envelopes/media-chunks.spec.ts
import { describe, it, expect } from 'vitest';
import {
  generateFileKey,
  deriveChunkNonce,
  encryptMediaChunk,
  decryptMediaChunk,
} from '../../src/envelopes/media-chunks.js';
import { CryptoError } from '../../src/errors.js';

describe('generateFileKey', () => {
  it('returns 32 random bytes', () => {
    const key1 = generateFileKey();
    const key2 = generateFileKey();
    expect(key1.length).toBe(32);
    expect(key2.length).toBe(32);
    expect(key1).not.toEqual(key2);
  });
});

describe('deriveChunkNonce', () => {
  it('deterministic: same inputs produce same nonce', async () => {
    const fileKey = generateFileKey();
    const nonce1 = await deriveChunkNonce(fileKey, 'rec-42', 0);
    const nonce2 = await deriveChunkNonce(fileKey, 'rec-42', 0);
    expect(nonce1).toEqual(nonce2);
    expect(nonce1.length).toBe(12);
  });

  it('different recordingId → different nonce on same index', async () => {
    const fileKey = generateFileKey();
    const nonce1 = await deriveChunkNonce(fileKey, 'rec-A', 5);
    const nonce2 = await deriveChunkNonce(fileKey, 'rec-B', 5);
    expect(nonce1).not.toEqual(nonce2);
  });

  it('different chunkIndex → different nonce', async () => {
    const fileKey = generateFileKey();
    const nonce0 = await deriveChunkNonce(fileKey, 'rec-42', 0);
    const nonce1 = await deriveChunkNonce(fileKey, 'rec-42', 1);
    expect(nonce0).not.toEqual(nonce1);
  });
});

describe('encryptMediaChunk / decryptMediaChunk', () => {
  it('roundtrip: encrypt and decrypt chunk 0..4', async () => {
    const fileKey = generateFileKey();
    const recordingId = 'test-rec-7';
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < 5; i++) {
      const chunkData = new Uint8Array(100);
      for (let j = 0; j < 100; j++) {
        chunkData[j] = (i * 100 + j) % 256;
      }

      const { encrypted, iv } = await encryptMediaChunk(fileKey, chunkData, recordingId, i);
      expect(iv.length).toBe(12);

      const decrypted = await decryptMediaChunk(encrypted, fileKey, recordingId, i);
      expect(decrypted).toEqual(chunkData);
      chunks.push(decrypted);
    }

    // Verify each chunk is different (different IVs)
    for (let i = 1; i < 5; i++) {
      const { iv: iv0 } = await encryptMediaChunk(fileKey, new Uint8Array(100), recordingId, 0);
      const { iv: ivi } = await encryptMediaChunk(fileKey, new Uint8Array(100), recordingId, i);
      expect(iv0).not.toEqual(ivi);
    }
  });

  it('determinism: encrypt twice with same inputs → same IV and ciphertext', async () => {
    const fileKey = generateFileKey();
    const chunkData = new Uint8Array([1, 2, 3, 4, 5]);

    const { encrypted: enc1, iv: iv1 } = await encryptMediaChunk(fileKey, chunkData, 'det-test', 0);
    const { encrypted: enc2, iv: iv2 } = await encryptMediaChunk(fileKey, chunkData, 'det-test', 0);

    expect(iv1).toEqual(iv2);
    expect(enc1).toEqual(enc2);
  });

  it('different recordingId → different IV on same index', async () => {
    const fileKey = generateFileKey();
    const chunkData = new Uint8Array([1, 2, 3]);

    const { iv: ivA } = await encryptMediaChunk(fileKey, chunkData, 'rec-A', 3);
    const { iv: ivB } = await encryptMediaChunk(fileKey, chunkData, 'rec-B', 3);

    expect(ivA).not.toEqual(ivB);
  });

  it('tamper chunk → DECRYPTION_FAILED', async () => {
    const fileKey = generateFileKey();
    const chunkData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const { encrypted, iv } = await encryptMediaChunk(fileKey, chunkData, 'tamper-test', 0);

    const tampered = new Uint8Array(encrypted);
    tampered[2] ^= 0xff;

    await expect(
      decryptMediaChunk(tampered, fileKey, 'tamper-test', 0)
    ).rejects.toThrow(CryptoError);
  });

  it('cross-file isolation: same chunkIndex, different fileKey → different IV', async () => {
    const fileKeyA = generateFileKey();
    const fileKeyB = generateFileKey();
    const chunkData = new Uint8Array([1, 2, 3]);

    const { iv: ivA } = await encryptMediaChunk(fileKeyA, chunkData, 'isolation-test', 10);
    const { iv: ivB } = await encryptMediaChunk(fileKeyB, chunkData, 'isolation-test', 10);

    expect(ivA).not.toEqual(ivB);
  });
});
