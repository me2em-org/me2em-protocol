import { describe, it, expect } from 'vitest';
import {
  generateSeedPhrase,
  get32ByteSeedFromMnemonic,
  validateSeedPhrase,
  wordlist,
} from '../src/index.js';

describe('BIP39 wordlist', () => {
  it('has exactly 2048 entries', () => {
    expect(wordlist.length).toBe(2048);
  });

  it('all entries are non-empty lowercase strings', () => {
    for (const word of wordlist) {
      expect(word.length).toBeGreaterThan(0);
      expect(word).toBe(word.toLowerCase());
    }
  });
});

describe('BIP39 passphrase support', () => {
  it('empty passphrase (default) matches no-passphrase derivation', async () => {
    const phrase = generateSeedPhrase(128);
    const a = await get32ByteSeedFromMnemonic(phrase);
    const b = await get32ByteSeedFromMnemonic(phrase, '');
    expect(a).toEqual(b);
  });

  it('different passphrases derive different seeds', async () => {
    const phrase = generateSeedPhrase(128);
    const a = await get32ByteSeedFromMnemonic(phrase, 'alpha');
    const b = await get32ByteSeedFromMnemonic(phrase, 'beta');
    expect(a).not.toEqual(b);
  });

  it('passphrase is deterministic', async () => {
    const phrase = generateSeedPhrase(128);
    const a = await get32ByteSeedFromMnemonic(phrase, 'secret phrase');
    const b = await get32ByteSeedFromMnemonic(phrase, 'secret phrase');
    expect(a).toEqual(b);
  });

  it('passphrase is case- and layout-sensitive (no silent normalization beyond NFKC)', async () => {
    const phrase = generateSeedPhrase(128);
    const lower = await get32ByteSeedFromMnemonic(phrase, 'secret');
    const upper = await get32ByteSeedFromMnemonic(phrase, 'SECRET');
    expect(lower).not.toEqual(upper);
  });

  it('NFKC folds compatibility forms in passphrase', async () => {
    const phrase = generateSeedPhrase(128);
    // ﬁ (U+FB01) folds to "fi"
    const folded = await get32ByteSeedFromMnemonic(phrase, '\uFB01le');
    const plain  = await get32ByteSeedFromMnemonic(phrase, 'file');
    expect(folded).toEqual(plain);
  });
});
