// packages/crypto/test/kdf/hash-identity.spec.ts
import { describe, it, expect } from 'vitest';
import { hashIdentityMaterial } from '../../src/kdf/hash-identity.js';
import { CryptoError } from '../../src/errors.js';

describe('hashIdentityMaterial', () => {
  it('is deterministic: same inputs produce same output', async () => {
    const key = new Uint8Array(32).fill(0x42);
    const id = 'test-identity-id';
    const r1 = await hashIdentityMaterial(key, id);
    const r2 = await hashIdentityMaterial(key, id);
    expect(r2).toEqual(r1);
  });

  it('different identityId produces different output (domain separation)', async () => {
    const key = new Uint8Array(32).fill(0x42);
    const r1 = await hashIdentityMaterial(key, 'identity-A');
    const r2 = await hashIdentityMaterial(key, 'identity-B');
    expect(r2).not.toEqual(r1);
  });

  it('different key produces different output', async () => {
    const key1 = new Uint8Array(32).fill(0x42);
    const key2 = new Uint8Array(32).fill(0x43);
    const r1 = await hashIdentityMaterial(key1, 'same-id');
    const r2 = await hashIdentityMaterial(key2, 'same-id');
    expect(r2).not.toEqual(r1);
  });

  it('returns 32 bytes', async () => {
    const key = new Uint8Array(32).fill(0x42);
    const result = await hashIdentityMaterial(key, 'id');
    expect(result.length).toBe(32);
  });

  it('throws INVALID_LENGTH for wrong key size', async () => {
    await expect(hashIdentityMaterial(new Uint8Array(16).fill(0x42), 'id')).rejects.toMatchObject({
      code: 'INVALID_LENGTH',
      level: 'KEY',
    });
  });
});
