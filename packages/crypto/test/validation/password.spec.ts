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
