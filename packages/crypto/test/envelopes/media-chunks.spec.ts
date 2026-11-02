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

    const { encrypted } = await encryptMediaChunk(fileKey, chunkData, 'tamper-test', 0);

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

  it('DANGER: reusing fileKey + same recordingId + same chunkIndex leaks plaintext XOR (GCM keystream reuse)', async () => {
    // ⚠️ This test documents WHY fileKey MUST be unique per file.
    //
    // AES-GCM: same key + same nonce → identical keystream. Two ciphertexts
    // C1 = P1 ⊕ KS, C2 = P2 ⊕ KS → C1 ⊕ C2 = P1 ⊕ P2 — plaintext XOR leaks.
    //
    // `deriveChunkNonce` is deterministic by design (no IV storage). It is
    // SAFE only because `generateFileKey()` returns a fresh random key per
    // file. Reusing a fileKey across files — or regenerating it
    // deterministically — reproduces the nonce under the same key, which is
    // catastrophic for GCM. This test pins that danger.
    const fileKey = generateFileKey();
    const p1 = new Uint8Array(16).fill(0xaa);
    const p2 = new Uint8Array(16).fill(0x55);

    const { encrypted: c1 } = await encryptMediaChunk(fileKey, p1, 'same-rec', 0);
    const { encrypted: c2 } = await encryptMediaChunk(fileKey, p2, 'same-rec', 0);

    // C1 ⊕ C2 == P1 ⊕ P2 for the plaintext span (the rest is GCM tag,
    // which differs — GCM uses key+nonce for the tag too, but the tag
    // length makes byte-wise comparison only meaningful over plaintext).
    const xorC = new Uint8Array(p1.length);
    const xorP = new Uint8Array(p1.length);
    for (let i = 0; i < p1.length; i++) {
      xorC[i] = c1[i] ^ c2[i];
      xorP[i] = p1[i] ^ p2[i];
    }

    expect(xorC).toEqual(xorP);
    // If this test ever fails, the fileKey-reuse danger is gone (or the
    // protocol has changed) — review before "fixing" it.
  });

  it('same fileKey + different recordingId → different ciphertext (recordingId is part of the nonce)', async () => {
    // Integration-level pin of the recordingId domain separation: two
    // encryptions with the same fileKey and chunkIndex but different
    // recordingIds MUST produce different ciphertexts — otherwise the
    // nonce would not depend on recordingId, and cross-recording reuse
    // would leak.
    const fileKey = generateFileKey();
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

    const { encrypted: cA, iv: ivA } = await encryptMediaChunk(fileKey, plaintext, 'rec-A', 0);
    const { encrypted: cB, iv: ivB } = await encryptMediaChunk(fileKey, plaintext, 'rec-B', 0);

    expect(ivA).not.toEqual(ivB);          // nonce differs
    expect(cA).not.toEqual(cB);            // ciphertext differs
  });
});
