// packages/crypto/src/validation/seed.ts
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export interface SeedValidationResult {
  isValid: boolean;
  error?: string;
  wordCount: number;
  invalidWords: string[];
}

/**
 * Normalizes a mnemonic seed phrase by splitting on whitespace,
 * lowercasing, trimming, and filtering empty strings.
 *
 * @param sp - The seed phrase as a string or array of words.
 * @returns Normalized array of lowercase words with duplicates preserved.
 *
 * @example
 * ```ts
 * const normalized = normalizeSeedPhrase('  ABANDON   abandon ');
 * // ['abandon', 'abandon']
 * ```
 */
export function normalizeSeedPhrase(sp: string | string[]): string[] {
  const words = Array.isArray(sp) ? sp : sp.split(/\s+/);
  return words
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 0);
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
 * @param words - The seed phrase words (already normalized or raw).
 * @returns A result object with isValid, error message, wordCount, and invalidWords.
 *
 * @example
 * ```ts
 * const result = validateSeedPhrase(['abandon', 'abandon', ...]);
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
