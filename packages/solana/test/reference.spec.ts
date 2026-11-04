// packages/solana/test/reference.spec.ts
//
// Ф3: createPaymentReference — 32 random bytes, base58-encoded;
// uniqueness across calls.
import { describe, it, expect } from 'vitest';
import { base58 } from '@scure/base';
import { createPaymentReference } from '../src/reference.js';
import { isValidSolanaAddress } from '../src/adapter.js';

describe('createPaymentReference', () => {
  it('produces base58 values that decode to exactly 32 bytes', () => {
    for (let i = 0; i < 64; i++) {
      const ref = createPaymentReference();
      expect(typeof ref).toBe('string');
      expect(ref.length).toBeGreaterThan(0);
      const decoded = base58.decode(ref); // throws on non-base58 — part of the pin
      expect(decoded).toHaveLength(32);
      // A reference is a plain 32-byte key: structurally a valid
      // Solana address shape (no on-curve requirement).
      expect(isValidSolanaAddress(ref)).toBe(true);
    }
  });

  it('is fresh per call (no reuse within a sample)', () => {
    const refs = new Set<string>();
    for (let i = 0; i < 256; i++) refs.add(createPaymentReference());
    expect(refs.size).toBe(256);
  });
});
