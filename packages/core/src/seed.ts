// seed.ts
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { sha256 } from './crypto/hkdf.js';

export type SeedStrength = 128 | 256; // 128 bits = 12 words, 256 bits = 24 words

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
 *   - 160 bits = 15 words
 *   - 192 bits = 18 words
 *   - 224 bits = 21 words
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

/**
 * Validates a mnemonic seed phrase against the BIP39 standard.
 *
 * Checks:
 * - Correct word count (12 or 24 words)
 * - All words exist in the BIP39 wordlist
 * - Valid checksum
 *
 * @param words - The mnemonic phrase to validate.
 * @returns An object with `isValid` flag and optional `error` message.
 *
 * @example
 * ```ts
 * const result = validateSeedPhrase(['abandon', 'abandon', ..., 'art']);
 * if (!result.isValid) console.error(result.error);
 * ```
 */
export function validateSeedPhrase(words: string[]): { isValid: boolean; error?: string } {
  const wordCount = words.length;
  if (wordCount !== 12 && wordCount !== 24) {
    return { isValid: false, error: `Seed phrase must be 12 or 24 words, got ${wordCount}` };
  }
  const normalized = normalizeSeedPhrase(words);
  for (const word of normalized) {
    if (!wordlist.includes(word)) {
      return { isValid: false, error: `Invalid word: ${word}` };
    }
  }
  const isValid = validateMnemonic(normalized.join(' '), wordlist);
  return { isValid, error: isValid ? undefined : 'Invalid seed phrase checksum' };
}

/**
 * Derives a 32-byte cryptographic seed from a BIP39 mnemonic phrase using PBKDF2.
 * This is the standard BIP39 derivation function that converts a human-readable
 * mnemonic into a binary seed suitable for Ed25519 key generation.
 *
 * The resulting 64-byte BIP39 seed is hashed with SHA-256 to produce a
 * deterministic 32-byte seed, as required by Ed25519.
 *
 * @param seedPhrase - The BIP39 mnemonic phrase (string or array of words).
 * @returns A Promise resolving to a 32-byte Uint8Array seed.
 *
 * @example
 * ```ts
 * const seed = await get32ByteSeedFromMnemonic('abandon abandon ... art');
 * // Uint8Array(32) [123, 45, 67, ...]
 * ```
 */
export async function get32ByteSeedFromMnemonic(
  seedPhrase: string | string[]
): Promise<Uint8Array> {
  const words = normalizeSeedPhrase(seedPhrase);
  const validation = validateSeedPhrase(words);
  if (!validation.isValid) {
    throw new Error(`Invalid seed phrase: ${validation.error}`);
  }
  const mnemonic = words.join(' ');
  const seed64 = await mnemonicToSeed(mnemonic);
  // Hash the 64-byte seed to get a deterministic 32-byte seed for Ed25519
  return sha256(seed64);
}
