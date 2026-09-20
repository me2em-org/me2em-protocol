// packages/crypto/test/core/aead.spec.ts
import { describe, it, expect } from 'vitest';
import { importAeadKey, encryptAead, decryptAead } from '../../src/core/aead.js';
import { CryptoError } from '../../src/errors.js';

describe('importAeadKey', () => {
  it('accepts 32-byte key', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    expect(key).toBeDefined();
  });

  it('throws INVALID_LENGTH for 16-byte key', async () => {
    await expect(importAeadKey(new Uint8Array(16).fill(0x42))).rejects.toMatchObject({
      code: 'INVALID_LENGTH',
      level: 'KEY',
    });
  });
});

describe('encryptAead / decryptAead', () => {
  it('roundtrip: encrypt then decrypt', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    const plaintext = new TextEncoder().encode('Hello, Me2em!');
    const { ciphertext, iv } = await encryptAead(key, plaintext);
    const decrypted = await decryptAead(key, ciphertext, iv);
    expect(decrypted).toEqual(plaintext);
  });

  it('tampered ciphertext fails decryption', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    const plaintext = new TextEncoder().encode('sensitive data');
    const { ciphertext, iv } = await encryptAead(key, plaintext);
    ciphertext[5] ^= 0xff; // flip a byte
    await expect(decryptAead(key, ciphertext, iv)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });
  });

  it('tampered IV fails decryption', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    const plaintext = new TextEncoder().encode('sensitive data');
    const { ciphertext, iv } = await encryptAead(key, plaintext);
    iv[0] ^= 0xff;
    await expect(decryptAead(key, ciphertext, iv)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
      level: 'CIPHER',
    });
  });

  it('two encryptions of same plaintext produce different IV/ciphertext', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    const plaintext = new TextEncoder().encode('same data');
    const r1 = await encryptAead(key, plaintext);
    const r2 = await encryptAead(key, plaintext);
    expect(r1.iv).not.toEqual(r2.iv);
    expect(r1.ciphertext).not.toEqual(r2.ciphertext);
  });

  it('ciphertext includes 16-byte GCM tag', async () => {
    const key = await importAeadKey(new Uint8Array(32).fill(0x42));
    const plaintext = new Uint8Array([1, 2, 3]);
    const { ciphertext } = await encryptAead(key, plaintext);
    expect(ciphertext.length).toBe(plaintext.length + 16);
  });
});
