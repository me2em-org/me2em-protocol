// packages/crypto/test/validation/password.spec.ts
import { describe, it, expect, vi } from 'vitest';
import {
  validatePasswordStrength,
  generateSecurePassword,
  quickPasswordValidation,
} from '../../src/validation/password.js';

describe('validatePasswordStrength', () => {
  it('strong password passes', async () => {
    const result = await validatePasswordStrength('MyStr0ng!Pass#2024x');
    expect(result.isSecure).toBe(true);
    expect(result.score).toBeGreaterThan(4);
    expect(result.feedback.length).toBeLessThan(result.maxScore);
  });

  it('weak password fails', async () => {
    const result = await validatePasswordStrength('password123!');
    expect(result.isSecure).toBe(false);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('sequential pattern detected', async () => {
    const result = await validatePasswordStrength('abcdefgh1!xyzABC');
    expect(result.feedback.some((f) => f.includes('sequential'))).toBe(true);
  });

  it('low entropy detected', async () => {
    const result = await validatePasswordStrength('aaaaaaa!');
    expect(result.feedback.some((f) => f.includes('entropy') || f.includes('short'))).toBe(true);
  });

  it('HIBP: fetch rejection returns isLeaked false (fail-open)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network'); };
    try {
      const result = await validatePasswordStrength('aaaaaaaaaaaaaaaa');
      expect(result.isLeaked).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('generateSecurePassword', () => {
  it('returns string of correct length', () => {
    const pw = generateSecurePassword(20);
    expect(pw.length).toBe(20);
  });

  it('minimum length is 8', () => {
    const pw = generateSecurePassword(5);
    expect(pw.length).toBe(8);
  });

  it('contains at least 2 of each character type', () => {
    const pw = generateSecurePassword(16);
    const lowerCount = (pw.match(/[a-z]/g) || []).length;
    const upperCount = (pw.match(/[A-Z]/g) || []).length;
    const digitCount = (pw.match(/[0-9]/g) || []).length;
    const specialCount = (pw.match(/[^a-zA-Z0-9]/g) || []).length;
    expect(lowerCount).toBeGreaterThanOrEqual(2);
    expect(upperCount).toBeGreaterThanOrEqual(2);
    expect(digitCount).toBeGreaterThanOrEqual(2);
    expect(specialCount).toBeGreaterThanOrEqual(2);
  });

  it('two calls produce different passwords', () => {
    const p1 = generateSecurePassword(16);
    const p2 = generateSecurePassword(16);
    expect(p2).not.toBe(p1);
  });

  it('all characters come from the declared charset', () => {
    // Uniformity of the shuffle distribution is verified OUTSIDE CI by
    // scripts/password-shuffle-bias.mjs (selection-corrected chi-square
    // over 50k samples, df = 87) — see the randomIntBelow JSDoc
    // (F2: unbiased Fisher-Yates; BL-43: unbiased selection). CI pins
    // only the charset and shape invariants.
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allowed = new Set([...(lower + upper + digits + special)]);
    for (let i = 0; i < 25; i++) {
      const pw = generateSecurePassword(16);
      for (const ch of pw) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it('selection is rejection-sampled, not modulo — BL-43 pin', () => {
    // Deterministic, non-statistical. randomIntBelow draws 32-bit words
    // from the global WebCrypto; the stub feeds a scripted queue and
    // falls back to all-zero words. 0xffffffff sits in the final partial
    // residue class for n=26 (max = 26·165191049 = 4294967274), so a
    // correct implementation MUST discard it and redraw — the queued 0
    // selects 'a'. A naive `word % n` would produce 0xffffffff % 26 = 21
    // → 'v'; the pre-BL-43 byte-modulo path would take 255 % 26 = 21 →
    // 'v' as well. Every later draw falls through to 0, so 'v' cannot
    // enter through another lane: `not.toContain('v')` is exact, not
    // statistical, and fails for ANY modulo-based selection.
    const queue: number[] = [0xffffffff, 0];
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    spy.mockImplementation(
      ((buf: Uint32Array) => {
        buf.fill(queue.shift() ?? 0);
        return buf;
      }) as unknown as typeof globalThis.crypto.getRandomValues,
    );
    try {
      const pw = generateSecurePassword(8);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      expect(pw.length).toBe(8);
      expect(pw).toContain('a');
      expect(pw).not.toContain('v');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('quickPasswordValidation', () => {
  it('strong password passes', () => {
    const result = quickPasswordValidation('MyStr0ng!Pass#2024x');
    expect(result.isValid).toBe(true);
  });

  it('short password fails', () => {
    const result = quickPasswordValidation('Short1!A');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('14');
  });

  it('missing uppercase fails', () => {
    const result = quickPasswordValidation('lowercase1!pass');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('uppercase');
  });

  it('missing digit fails', () => {
    const result = quickPasswordValidation('NoDigitsHere!X');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('numbers');
  });
});
