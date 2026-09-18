// packages/crypto/test/utils/binary.spec.ts
import { describe, it, expect } from 'vitest';
import {
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  concat,
  randomBytes,
  randomBytesB64,
  bytesEqual,
} from '../../src/utils/binary.js';

describe('toBase64 / fromBase64', () => {
  it('roundtrip', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
    const b64 = toBase64(original);
    const decoded = fromBase64(b64);
    expect(decoded).toEqual(original);
  });

  it('empty array', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('')).toEqual(new Uint8Array(0));
  });

  it('known vector', () => {
    expect(toBase64(new Uint8Array([0xff, 0x00]))).toBe('/wA=');
  });
});

describe('toHex / fromHex', () => {
  it('roundtrip', () => {
    const original = new Uint8Array([0x0f, 0xff, 0xab, 0xcd]);
    const hex = toHex(original);
    const decoded = fromHex(hex);
    expect(decoded).toEqual(original);
  });

  it('lowercase output', () => {
    expect(toHex(new Uint8Array([0x0a, 0xff]))).toBe('0aff');
  });

  it('throws on odd-length hex string', () => {
    expect(() => fromHex('abc')).toThrow('even length');
  });

  it('throws on invalid hex characters', () => {
    expect(() => fromHex('gg')).toThrow();
  });
});

describe('concat', () => {
  it('concatenates two arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    const result = concat(a, b);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('handles empty arrays', () => {
    const a = new Uint8Array([1, 2]);
    expect(concat(a, new Uint8Array(0))).toEqual(a);
    expect(concat(new Uint8Array(0), a)).toEqual(a);
    expect(concat()).toEqual(new Uint8Array(0));
  });

  it('does not mutate inputs', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const result = concat(a, b);
    expect(a).toEqual(new Uint8Array([1, 2]));
    expect(b).toEqual(new Uint8Array([3]));
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
  });
});

describe('randomBytes', () => {
  it('returns array of given length', () => {
    const r = randomBytes(64);
    expect(r.length).toBe(64);
  });

  it('produces different values on each call', () => {
    const r1 = randomBytes(16);
    const r2 = randomBytes(16);
    // Probability of collision is negligible for 16 bytes
    expect(r2).not.toEqual(r1);
  });
});

describe('randomBytesB64', () => {
  it('returns base64 string', () => {
    const s = randomBytesB64(16);
    expect(typeof s).toBe('string');
    // 16 bytes -> 24 base64 chars
    expect(s.length).toBe(24);
  });

  it('different calls produce different strings', () => {
    const s1 = randomBytesB64(16);
    const s2 = randomBytesB64(16);
    expect(s2).not.toBe(s1);
  });
});

describe('bytesEqual', () => {
  it('returns true for identical arrays', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('returns false for different length', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('returns false for different content same length', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('returns true for two empty arrays', () => {
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});
