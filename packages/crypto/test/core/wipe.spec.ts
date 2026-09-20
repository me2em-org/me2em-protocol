// packages/crypto/test/core/wipe.spec.ts
import { describe, it, expect } from 'vitest';
import { secureWipe, withSecureWipe, secureWipeMultiple } from '../../src/core/wipe.js';

describe('secureWipe', () => {
  it('overwrites all bytes with zeros after two passes', () => {
    const arr = new Uint8Array([0x01, 0x02, 0x03, 0xff, 0xab]);
    secureWipe(arr);
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]).toBe(0);
    }
  });

  it('handles empty array', () => {
    const arr = new Uint8Array(0);
    secureWipe(arr); // should not throw
    expect(arr.length).toBe(0);
  });

  it('does not return the array (void)', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const result = secureWipe(arr);
    expect(result).toBeUndefined();
  });
});

describe('withSecureWipe', () => {
  it('returns the operation result and wipes data', async () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = await withSecureWipe(data, async (d) => {
      expect(d[0]).toBe(0xde);
      return d[0] + d[1];
    });
    expect(result).toBe(0xde + 0xad);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });

  it('wipes data even when operation throws', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await expect(
      withSecureWipe(data, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(0);
    }
  });
});

describe('secureWipeMultiple', () => {
  it('wipes all provided arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    const c = new Uint8Array([5, 6, 7]);
    secureWipeMultiple(a, b, c);
    for (const arr of [a, b, c]) {
      for (let i = 0; i < arr.length; i++) {
        expect(arr[i]).toBe(0);
      }
    }
  });
});
