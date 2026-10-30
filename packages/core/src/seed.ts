// packages/core/src/seed.ts
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Seed strength in bits. 128 bits → 12 words, 256 bits → 24 words.
 * Intermediate strengths (160/192/224 → 15/18/21 words) are valid
 * BIP39 strengths but intentionally NOT exposed by this API; extend
 * the union deliberately if ever needed (BREAKING for exhaustiveness
 * checks).
 */
export type SeedStrength = 128 | 256;

/**
 * Utilities for BIP39 mnemonic seed phrase generation and validation.
 * These functions provide secure, deterministic seed phrase handling
 * compatible with the BIP39 standard.
 *
 * @category Seed Utilities
 * @packageDocumentation
 */

/**
 * Generates a cryptographically secure random mnemonic seed phrase.
 *
 * @param strength - The entropy strength in bits.
 *   - 128 bits = 12 words (standard security)
 *   - 256 bits = 24 words (maximum security)
 * @returns A space-separated mnemonic string split into an array of words.
 *
 * @example
 * ```ts
 * const mnemonic12 = generateSeedPhrase(128);
 * // ["abandon", "abandon", ..., "art"]
 *
 * const mnemonic24 = generateSeedPhrase(256);
 * // ["abandon", "abandon", ..., "zoo"] (24 words)
 * ```
 */
export function generateSeedPhrase(strength: SeedStrength = 128): string[] {
  if (strength !== 128 && strength !== 256) {
    throw new Error('Seed strength must be 128 (12 words) or 256 (24 words)');
  }
  const mnemonic = generateMnemonic(wordlist, strength);
  return mnemonic.split(' ');
}

/**
 * Normalizes a mnemonic seed phrase by trimming whitespace and converting to lowercase.
 *
 * @param seedPhrase - The mnemonic phrase to normalize (string or array of words).
 * @returns A normalized array of lowercase words.
 *
 * @example
 * ```ts
 * const normalized = normalizeSeedPhrase('  ABANDON  abandon  ART  ');
 * // ["abandon", "abandon", "art"]
 * ```
 */
export function normalizeSeedPhrase(seedPhrase: string | string[]): string[] {
  const words = Array.isArray(seedPhrase)
    ? seedPhrase
    : seedPhrase.trim().split(/\s+/);
  return words.map(word => word.toLowerCase().trim()).filter(word => word.length > 0);
}

export interface SeedValidationResult {
  isValid: boolean;
  error?: string;
  wordCount: number;
  invalidWords: string[];
}

/**
 * Validates a mnemonic seed phrase against the BIP39 standard with
 * detailed feedback.
 *
 * Checks (in order):
 * 1. Word count must be 12 or 24.
 * 2. Each word must exist in the BIP39 English wordlist.
 * 3. Checksum must be valid.
 *
 * @param words - The mnemonic phrase to validate.
 * @returns A result object with isValid, error, wordCount, and invalidWords.
 *
 * @example
 * ```ts
 * const result = validateSeedPhrase(['abandon', 'abandon', ..., 'art']);
 * if (!result.isValid) {
 *   console.error(result.error);
 *   console.log('Invalid words:', result.invalidWords);
 * }
 * ```
 */
export function validateSeedPhrase(words: string[]): SeedValidationResult {
  const normalized = normalizeSeedPhrase(words);
  const invalidWords: string[] = [];

  for (const word of normalized) {
    if (!wordlist.includes(word)) {
      invalidWords.push(word);
    }
  }

  if (normalized.length !== 12 && normalized.length !== 24) {
    return {
      isValid: false,
      error: `Seed phrase must be 12 or 24 words, got ${normalized.length}`,
      wordCount: normalized.length,
      invalidWords,
    };
  }

  if (invalidWords.length > 0) {
    return {
      isValid: false,
      error: `Invalid words found: ${invalidWords.join(', ')}`,
      wordCount: normalized.length,
      invalidWords,
    };
  }

  const isValid = validateMnemonic(normalized.join(' '), wordlist);
  return {
    isValid,
    error: isValid ? undefined : 'Invalid seed phrase checksum',
    wordCount: normalized.length,
    invalidWords: [],
  };
}

/**
 * Derives the 64-byte BIP39 seed from a mnemonic phrase using PBKDF2
 * (PBKDF2-HMAC-SHA512, 2048 iterations, salt `"mnemonic" + passphrase`).
 * This is the standard BIP39 derivation: the full 512-bit seed is returned
 * unmodified and serves as the input key material for identity derivation
 * ({@link Identity.fromSeed} applies HKDF-SHA256 on top).
 *
 * Both 12-word (128-bit) and 24-word (256-bit) mnemonics produce the same
 * 64-byte seed length, per the BIP39 standard.
 *
 * @param seedPhrase - The BIP39 mnemonic phrase (string or array of words).
 * @param passphrase - Optional BIP39 passphrase ("25th word").
 *   Normalized via NFKC before use. An empty string (default)
 *   matches phrases without a passphrase. WARNING: the passphrase
 *   is NOT recoverable — a different passphrase silently derives a
 *   completely different seed with no error indication. Store it
 *   as carefully as the mnemonic itself.
 * @returns A Promise resolving to the 64-byte Uint8Array BIP39 seed.
 *
 * @example
 * ```ts
 * const seed = await get64ByteSeedFromMnemonic('abandon abandon ... art');
 * // Uint8Array(64) [94, 176, 187, ...]
 *
 * const seedWithPassphrase = await get64ByteSeedFromMnemonic(words, 'my secret 25th word');
 * ```
 */
export async function get64ByteSeedFromMnemonic(
  seedPhrase: string | string[],
  passphrase: string = ''
): Promise<Uint8Array> {
  const words = normalizeSeedPhrase(seedPhrase);
  const validation = validateSeedPhrase(words);
  if (!validation.isValid) {
    throw new Error(`Invalid seed phrase: ${validation.error}`);
  }
  const mnemonic = words.join(' ');
  // Full 64-byte BIP39 seed (PBKDF2-HMAC-SHA512 output) — no post-hashing
  return mnemonicToSeed(mnemonic, passphrase.normalize('NFKC'));
}
