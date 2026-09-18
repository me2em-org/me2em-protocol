// packages/crypto/test/validation/seed.spec.ts
import { describe, it, expect } from 'vitest';
import { generateSeedPhrase } from '@me2em/core';
import { normalizeSeedPhrase, validateSeedPhrase } from '../../src/validation/seed.js';

describe('normalizeSeedPhrase', () => {
  it('normalizes mixed-case with extra whitespace', () => {
    const result = normalizeSeedPhrase('  ABANDON   abandon  ');
    expect(result).toEqual(['abandon', 'abandon']);
  });

  it('handles array input', () => {
    const result = normalizeSeedPhrase(['Abandon', '  ART  ']);
    expect(result).toEqual(['abandon', 'art']);
  });

  it('filters empty strings', () => {
    const result = normalizeSeedPhrase(['', 'abandon', '', 'art', '']);
    expect(result).toEqual(['abandon', 'art']);
  });

  it('handles string with only whitespace', () => {
    const result = normalizeSeedPhrase('   ');
    expect(result).toEqual([]);
  });
});

describe('validateSeedPhrase', () => {
  it('validates a real 12-word phrase', () => {
    const phrase = generateSeedPhrase(128);
    const result = validateSeedPhrase(phrase);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.wordCount).toBe(12);
    expect(result.invalidWords).toEqual([]);
  });

  it('validates a real 24-word phrase', () => {
    const phrase = generateSeedPhrase(256);
    const result = validateSeedPhrase(phrase);
    expect(result.isValid).toBe(true);
    expect(result.wordCount).toBe(24);
  });

  it('rejects invalid word', () => {
    const phrase = generateSeedPhrase(128);
    const bad = [...phrase];
    bad[0] = 'notaword';
    const result = validateSeedPhrase(bad);
    expect(result.isValid).toBe(false);
    expect(result.invalidWords).toContain('notaword');
  });

  it('rejects bad checksum (swap two words)', () => {
    const phrase = generateSeedPhrase(128);
    const swapped = [...phrase];
    const temp = swapped[0];
    swapped[0] = swapped[1];
    swapped[1] = temp;
    const result = validateSeedPhrase(swapped);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('checksum');
  });

  it('rejects 13 words', () => {
    const phrase = generateSeedPhrase(128);
    const extra = [...phrase, 'art'];
    const result = validateSeedPhrase(extra);
    expect(result.isValid).toBe(false);
    expect(result.wordCount).toBe(13);
    expect(result.error).toContain('13');
  });
});
