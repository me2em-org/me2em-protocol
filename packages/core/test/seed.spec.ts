// packages/core/test/seed.spec.ts
import { describe, it, expect } from 'vitest';
import {
  Identity,
  generateSeedPhrase,
  get64ByteSeedFromMnemonic,
  validateSeedPhrase,
  wordlist,
} from '../src/index.js';
import { expectAttestationError } from './test-utils.js';

// Official BIP39 test vector: "abandon … about" (12 words), empty passphrase.
// Cross-verified against two independent PBKDF2-HMAC-SHA512 implementations.
const VECTOR_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VECTOR_12_SEED_HEX =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

// BIP39 vector: "abandon ×23 art" (24 words), empty passphrase.
// Computed via PBKDF2-HMAC-SHA512 (2048 iterations), cross-verified against
// an independent implementation of the standard derivation.
const VECTOR_24 = `${'abandon '.repeat(23)}art`;
const VECTOR_24_SEED_HEX =
  '408b285c123836004f4b8842c89324c1f01382450c0d439af345ba7fc49acf705489c6fc77dbd4e3dc1dd8cc6bc9f043db8ada1e243c4a0eafb290d399480840';

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
    const a = await get64ByteSeedFromMnemonic(phrase);
    const b = await get64ByteSeedFromMnemonic(phrase, '');
    expect(a).toEqual(b);
  });

  it('different passphrases derive different seeds', async () => {
    const phrase = generateSeedPhrase(128);
    const a = await get64ByteSeedFromMnemonic(phrase, 'alpha');
    const b = await get64ByteSeedFromMnemonic(phrase, 'beta');
    expect(a).not.toEqual(b);
  });

  it('passphrase is deterministic', async () => {
    const phrase = generateSeedPhrase(128);
    const a = await get64ByteSeedFromMnemonic(phrase, 'secret phrase');
    const b = await get64ByteSeedFromMnemonic(phrase, 'secret phrase');
    expect(a).toEqual(b);
  });

  it('passphrase is case-sensitive (NFKD folds forms but not case)', async () => {
    const phrase = generateSeedPhrase(128);
    const lower = await get64ByteSeedFromMnemonic(phrase, 'secret');
    const upper = await get64ByteSeedFromMnemonic(phrase, 'SECRET');
    expect(lower).not.toEqual(upper);
  });

  it('NFKD folds compatibility forms in passphrase (BIP39 canonicalization)', async () => {
    const phrase = generateSeedPhrase(128);
    // ﬁ (U+FB01) folds to "fi"
    const folded = await get64ByteSeedFromMnemonic(phrase, '\uFB01le');
    const plain  = await get64ByteSeedFromMnemonic(phrase, 'file');
    expect(folded).toEqual(plain);
  });

  it('passphrase bytes identical with or without pre-NFKC (UAX #15 pin)', async () => {
    // NFKD(NFKC(x)) === NFKD(x) for all strings (UAX #15): the removed
    // explicit NFKC pre-normalization was byte-redundant — the BIP39
    // layer normalizes (NFKD) the whole salt. If @scure/bip39 ever
    // changes its normalization behavior, this pin fails loudly and
    // forces an explicit decision instead of a silent derivation change
    // (empirical base: packages/core/scripts/nfkd-redundancy-check.mjs
    // — 1,112,064-codepoint sweep, 784 starter+combining pairs, 200k-row
    // fuzz, zero mismatches).
    const matrix = [
      'caf\u00E9',                          // precomposed é
      'cafe\u0301',                         // e + combining acute
      '\uFB01le',                           // ﬁ ligature
      '\uFF34\uFF32\uFF25\uFF3A\uFF2F\uFF32', // ＴＲＥＺＯＲ (fullwidth)
      '\u1100\u1161\u11AB',                // hangul jamo
      '\u212B',                             // Å (Angstrom sign)
    ];
    for (const p of matrix) {
      const direct = await get64ByteSeedFromMnemonic(VECTOR_12, p);
      const preNfkc = await get64ByteSeedFromMnemonic(VECTOR_12, p.normalize('NFKC'));
      expect(Buffer.from(direct).toString('hex')).toBe(Buffer.from(preNfkc).toString('hex'));
    }
  });
});

describe('64-byte BIP39 seed (D1)', () => {
  it('matches the official BIP39 vector (12 words, empty passphrase)', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12);
    expect(Buffer.from(seed).toString('hex')).toBe(VECTOR_12_SEED_HEX);
  });

  it('matches the BIP39 vector (24 words, empty passphrase)', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_24);
    expect(Buffer.from(seed).toString('hex')).toBe(VECTOR_24_SEED_HEX);
  });

  it('a passphrase changes the seed deterministically (vector, "me2em")', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12, 'me2em');
    // Computed via PBKDF2-HMAC-SHA512 (2048 iterations), cross-verified
    // against an independent implementation of the standard derivation.
    expect(Buffer.from(seed).toString('hex')).toBe(
      '94912779e2012dd63a4f2e814bcb44d6d081983fedaaf45e2abe6f1b69abce6618b9a2270f05eb41b892e356a4c5e4901b09e0824d6a71f78e670d010ccb0417'
    );
  });

  it('12-word mnemonic produces a 64-byte seed', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it('24-word mnemonic produces a 64-byte seed', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_24);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it('12-word and 24-word mnemonics derive different seeds', async () => {
    const s12 = await get64ByteSeedFromMnemonic(VECTOR_12);
    const s24 = await get64ByteSeedFromMnemonic(VECTOR_24);
    expect(Buffer.from(s12).toString('hex')).not.toBe(
      Buffer.from(s24).toString('hex')
    );
  });

  it('derivation is deterministic for the same mnemonic', async () => {
    const a = await get64ByteSeedFromMnemonic(VECTOR_12);
    const b = await get64ByteSeedFromMnemonic(VECTOR_12.split(' '));
    expect(a).toEqual(b);
  });

  it('accepts mixed case and extra whitespace (normalization)', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12);
    const noisy = await get64ByteSeedFromMnemonic(
      `  ${VECTOR_12.toUpperCase().split(/\s+/).join('  ')}  `
    );
    // Mnemonic words are lowercase in the wordlist; normalization lowercases them
    expect(Buffer.from(noisy).toString('hex')).toBe(
      Buffer.from(seed).toString('hex')
    );
  });
});

describe('Identity.fromSeed 64-byte contract', () => {
  it('derives an Identity from the 12-word vector seed (HKDF output stays 32 bytes)', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12);
    const identity = await Identity.fromSeed(seed);
    // HKDF-SHA256 output length is unchanged by the longer IKM
    expect(identity.getPublicKey().length).toBe(32);
  });

  it('derives the same Identity from bytes and 128-char hex', async () => {
    const seed = await get64ByteSeedFromMnemonic(VECTOR_12);
    const hex = Buffer.from(seed).toString('hex');
    expect(hex).toHaveLength(128);
    const fromBytes = await Identity.fromSeed(seed);
    const fromHex = await Identity.fromSeed(hex);
    expect(fromBytes.getPublicKey()).toEqual(fromHex.getPublicKey());
  });

  it('same seed → same handle, different seeds → different handles', async () => {
    const s12 = await get64ByteSeedFromMnemonic(VECTOR_12);
    const s24 = await get64ByteSeedFromMnemonic(VECTOR_24);
    const a1 = await (await Identity.fromSeed(s12)).deriveHandle('work');
    const a2 = await (await Identity.fromSeed(s12)).deriveHandle('work');
    const b = await (await Identity.fromSeed(s24)).deriveHandle('work');
    expect(a1.getId()).toBe(a2.getId());
    expect(a1.getId()).not.toBe(b.getId());
  });

  it('rejects the legacy 32-byte seed', async () => {
    const legacy = new Uint8Array(32).fill(42);
    await expectAttestationError(Identity.fromSeed(legacy), 'MALFORMED', 'FORMAT');
  });

  it('rejects the legacy 64-char hex seed string', async () => {
    const legacyHex = '2a'.repeat(32); // 64 hex chars = legacy 32-byte seed
    await expectAttestationError(Identity.fromSeed(legacyHex), 'MALFORMED', 'FORMAT');
  });

  it('rejects a 63-byte seed', async () => {
    await expectAttestationError(Identity.fromSeed(new Uint8Array(63)), 'MALFORMED', 'FORMAT');
  });

  it('rejects a 65-byte seed', async () => {
    await expectAttestationError(Identity.fromSeed(new Uint8Array(65)), 'MALFORMED', 'FORMAT');
  });

  it('rejects an invalid mnemonic', async () => {
    await expectAttestationError(
      get64ByteSeedFromMnemonic(['not', 'a', 'valid', 'mnemonic']),
      'MALFORMED', 'FORMAT'
    );
  });

  it('validateSeedPhrase still accepts 12 and 24 words (unchanged)', () => {
    expect(validateSeedPhrase(VECTOR_12.split(' ')).isValid).toBe(true);
    expect(validateSeedPhrase(VECTOR_24.split(' ')).isValid).toBe(true);
  });

  it('rejects an invalid strength (not 128 or 256)', () => {
    expect(() => generateSeedPhrase(192 as 128)).toThrow(
      /Seed strength must be 128 \(12 words\) or 256 \(24 words\)/
    );
  });

  it('reports invalid words in an otherwise well-formed phrase', () => {
    const words = VECTOR_12.split(' ');
    words[11] = 'zzzznotaword'; // 12 words, last one not in the wordlist
    const result = validateSeedPhrase(words);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Invalid words found');
    expect(result.error).toContain('zzzznotaword');
  });
});
