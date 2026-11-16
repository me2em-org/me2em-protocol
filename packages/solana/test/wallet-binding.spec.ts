// packages/solana/test/wallet-binding.spec.ts
//
// Ф4: verifyWalletBindingSolana — on-curve checks, error handling,
// delegate behavior.
import { describe, it, expect } from 'vitest';
import { verifyWalletBindingSolana } from '../src/wallet-binding.js';
import { base58 } from '@scure/base';

// Helper: create a WalletDescriptor from an address string
function wallet(address: string) {
  return { address } as Parameters<typeof verifyWalletBindingSolana>[0];
}

// Valid Solana addresses (on-curve Ed25519, from golden test vectors)
const VALID_ON_CURVE_1 = 'QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi';
const VALID_ON_CURVE_2 = 'Fyf8KHrQXp7zC4DQuPohFqXfEv5FTzAr4pFRX1Z2RecA';
const VALID_ON_CURVE_3 = 'Cd2RttH7gzMTy7ZbNwGFDSWY5PYwESAVpgogtWJxh9HB';

describe('verifyWalletBindingSolana — on-curve checks', () => {
  it('returns true for valid on-curve public keys', () => {
    expect(verifyWalletBindingSolana(wallet(VALID_ON_CURVE_1))).toBe(true);
    expect(verifyWalletBindingSolana(wallet(VALID_ON_CURVE_2))).toBe(true);
    expect(verifyWalletBindingSolana(wallet(VALID_ON_CURVE_3))).toBe(true);
  });

  it('returns false for off-curve 32-byte keys (all 0xFF with high bit clear)', () => {
    const offCurveBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) offCurveBytes[i] = 0xFF;
    offCurveBytes[31] &= 0x7F;
    const offCurveAddr = base58.encode(offCurveBytes);
    expect(verifyWalletBindingSolana(wallet(offCurveAddr))).toBe(false);
  });

  it('returns false for 0x58...0 pattern (known off-curve)', () => {
    const offCurveBytes = new Uint8Array(32);
    offCurveBytes[0] = 0x58;
    const offCurveAddr = base58.encode(offCurveBytes);
    expect(verifyWalletBindingSolana(wallet(offCurveAddr))).toBe(false);
  });

  it('returns false for invalid base58 strings', () => {
    expect(verifyWalletBindingSolana(wallet('not-a-base58-key!!!'))).toBe(false);
    expect(verifyWalletBindingSolana(wallet(''))).toBe(false);
  });

  it('returns false for wrong-length keys (decodes to ≠ 32 bytes)', () => {
    expect(verifyWalletBindingSolana(wallet('111111'))).toBe(false);
    expect(
      verifyWalletBindingSolana(
        wallet('1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111')
      )
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(verifyWalletBindingSolana(null as unknown as Parameters<typeof verifyWalletBindingSolana>[0])).toBe(false);
    expect(verifyWalletBindingSolana(undefined as unknown as Parameters<typeof verifyWalletBindingSolana>[0])).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(verifyWalletBindingSolana(123 as unknown as Parameters<typeof verifyWalletBindingSolana>[0])).toBe(false);
    expect(verifyWalletBindingSolana('string' as unknown as Parameters<typeof verifyWalletBindingSolana>[0])).toBe(false);
    expect(verifyWalletBindingSolana([] as unknown as Parameters<typeof verifyWalletBindingSolana>[0])).toBe(false);
  });
});

describe('verifyWalletBindingSolana — delegate behavior', () => {
  it('is a function that takes a single argument', () => {
    expect(typeof verifyWalletBindingSolana).toBe('function');
    expect(verifyWalletBindingSolana.length).toBe(1);
  });

  it('consistent results for the same input', () => {
    const w = wallet(VALID_ON_CURVE_1);
    expect(verifyWalletBindingSolana(w)).toBe(true);
    expect(verifyWalletBindingSolana(w)).toBe(true);
  });
});
