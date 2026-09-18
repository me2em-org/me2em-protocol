// packages/crypto/test/core/hkdf.spec.ts
import { describe, it, expect } from 'vitest';
import { hkdf, hkdfWithInfo } from '../../src/core/hkdf.js';
import { CryptoError } from '../../src/errors.js';

// RFC 5869 Test Case 1
const TC1_IKM = new Uint8Array(
  '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'.match(/.{2}/g)!.map((b) => parseInt(b, 16))
);
// Fix: 22 bytes of 0x0b
const TC1_IKM_FIXED = new Uint8Array(22).fill(0x0b);
const TC1_SALT = new Uint8Array('000102030405060708090a0b0c'.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const TC1_INFO = new Uint8Array('f0f1f2f3f4f5f6f7f8f9'.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const TC1_EXPECTED = new Uint8Array(
  '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
    .match(/.{2}/g)!
    .map((b) => parseInt(b, 16))
);

describe('hkdf', () => {
  it('passes RFC 5869 Test Case 1', async () => {
    const result = await hkdf(TC1_IKM_FIXED, TC1_SALT, TC1_INFO, 42);
    expect(result).toEqual(TC1_EXPECTED);
  });

  it('is deterministic: two calls with same inputs produce same output', async () => {
    const r1 = await hkdf(TC1_IKM_FIXED, TC1_SALT, TC1_INFO, 32);
    const r2 = await hkdf(TC1_IKM_FIXED, TC1_SALT, TC1_INFO, 32);
    expect(r1).toEqual(r2);
  });

  it('passes RFC 5869 Test Case 3 (zero-length salt and info)', async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = new Uint8Array(0);
    const info = new Uint8Array(0);
    const expected = new Uint8Array(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8'
        .match(/.{2}/g)!
        .map((b) => parseInt(b, 16))
    );
    const result = await hkdf(ikm, salt, info, 42);
    expect(result).toEqual(expected);
  });

  it('throws CryptoError for length > 8160', async () => {
    await expect(hkdf(new Uint8Array(32), new Uint8Array(16), new Uint8Array(10), 8161)).rejects
      .toBeInstanceOf(CryptoError);
    await expect(hkdf(new Uint8Array(32), new Uint8Array(16), new Uint8Array(10), 8161)).rejects.toMatchObject({
      code: 'DERIVATION_FAILED',
      level: 'KDF',
    });
  });

  it('produces different output for different info', async () => {
    const ikm = new Uint8Array(32).fill(0x42);
    const salt = new Uint8Array(16).fill(0x01);
    const r1 = await hkdf(ikm, salt, new Uint8Array([0x01]), 32);
    const r2 = await hkdf(ikm, salt, new Uint8Array([0x02]), 32);
    expect(r1).not.toEqual(r2);
  });
});

describe('hkdfWithInfo', () => {
  it('wraps hkdf with string info', async () => {
    const ikm = new Uint8Array(32).fill(0x42);
    const salt = new Uint8Array(16).fill(0x01);
    const r1 = await hkdfWithInfo(ikm, salt, 'me2em/crypto/v1/test', 32);
    const r2 = await hkdf(ikm, salt, new TextEncoder().encode('me2em/crypto/v1/test'), 32);
    expect(r1).toEqual(r2);
  });
});
