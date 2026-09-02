import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { sha256 } from './crypto/hkdf.js';

export type SeedStrength = 128 | 256; // 128 bits = 12 words, 256 bits = 24 words

/**
 * Generates a BIP39 mnemonic phrase.
 * @param strength - 128 for 12 words (default), 256 for 24 words.
 * @returns Array of words.
 */
export function generateSeedPhrase(strength: SeedStrength = 128): string[] {
  if (strength !== 128 && strength !== 256) {
    throw new Error('Seed strength must be 128 (12 words) or 256 (24 words)');
  }
  const mnemonic = generateMnemonic(wordlist, strength);
  return mnemonic.split(' ');
}

/**
 * Normalizes a seed phrase (lowercase, trimmed, removes extra spaces).
 */
export function normalizeSeedPhrase(seedPhrase: string | string[]): string[] {
  const words = Array.isArray(seedPhrase) ? seedPhrase : seedPhrase.trim().split(/\s+/);
  return words.map(word => word.toLowerCase().trim()).filter(word => word.length > 0);
}

/**
 * Validates a BIP39 seed phrase.
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
 * Converts a BIP39 mnemonic phrase into a 32-byte Uint8Array suitable for Ed25519.
 * BIP39 produces a 64-byte seed. We hash it with SHA-256 to get exactly 32 bytes deterministically.
 */
export async function get32ByteSeedFromMnemonic(seedPhrase: string | string[]): Promise<Uint8Array> {
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
