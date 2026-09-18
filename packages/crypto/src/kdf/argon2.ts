// packages/crypto/src/kdf/argon2.ts
import { argon2id } from 'hash-wasm';
import { randomBytes } from '../utils/binary.js';
import { throwCryptoError } from '../errors.js';

/**
 * Named Argon2id profiles for different security scenarios.
 *
 * INTERACTIVE (t=3, m=64 MiB): OWASP recommended minimum for
 * password authentication where users log in frequently. Latency
 * ~100-300ms on modern hardware.
 *
 * SENSITIVE (t=3, m=256 MiB): for scenarios where the password
 * protects HIGH-VALUE material — e.g. encrypting a seed phrase
 * for cloud backup. Latency ~1s. An attacker brute-forcing an
 * offline-stolen envelope faces 4× the memory cost per guess,
 * which multiplies GPU/ASIC attack costs dramatically.
 */
export const ARGON2_PROFILES = {
  INTERACTIVE: { iterations: 3, memorySizeKiB: 65536, parallelism: 1, hashLength: 32 },
  SENSITIVE:   { iterations: 3, memorySizeKiB: 262144, parallelism: 1, hashLength: 32 },
} as const;

export type Argon2Profile = keyof typeof ARGON2_PROFILES;

export interface Argon2Params {
  iterations: number;
  memorySizeKiB: number;
  parallelism: number;
  hashLength: number;
}

export interface Argon2Options {
  /** Named profile: INTERACTIVE (default) or SENSITIVE. */
  profile?: Argon2Profile;
  /** Explicit overrides (rare — prefer profiles). Overrides applied on top of profile. */
  overrides?: { iterations?: number; memorySizeKiB?: number; parallelism?: number; hashLength?: number };
}

/**
 * Derives a key from a human password using Argon2id (RFC 9106,
 * hybrid mode — side-channel AND GPU resistant).
 *
 * When to use THIS vs hkdf()?
 * - argon2id(): the input is a HUMAN PASSWORD (low entropy,
 *   dictionary-attackable). Slow KDF is the point — it makes
 *   offline brute-force expensive.
 * - hkdf(): the input is HIGH-ENTROPY material (derived from a
 *   seed or another key). Fast KDF is correct — there is nothing
 *   to brute-force.
 *
 * Using hkdf() for passwords or argon2id() for key material is a
 * design error: one wastes user time, the other invites brute-force.
 *
 * Salt rules:
 * - FRESH random salt (≥16B) for every new encryption. NEVER
 *   reuse a salt across envelopes.
 * - The salt is NOT secret — store it alongside the envelope.
 * - generateArgon2Salt() produces a compliant salt.
 *
 * @param password - The human password. NFKC-normalized internally.
 * @param salt - ≥16 random bytes. Generate via generateArgon2Salt()
 *   for new envelopes; reuse the stored salt for verification.
 * @param options - Profile or explicit overrides.
 * @returns Derived key material (default 32B) for importAeadKey().
 * @throws {CryptoError} 'KDF/DERIVATION_FAILED' if hash-wasm fails
 *   or params are invalid (salt < 16B, iterations < 1).
 *
 * @example
 * ```ts
 * // Encrypting a seed backup with a password:
 * const salt = generateArgon2Salt();
 * const key = await deriveKeyArgon2id(userPassword, salt,
 *   { profile: 'SENSITIVE' });
 * const aeadKey = await importAeadKey(key);
 * const { ciphertext, iv } = await encryptAead(aeadKey, seedBytes);
 * // persist: { salt (b64), iv (b64), ciphertext (b64), profile }
 * ```
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  options: Argon2Options = {}
): Promise<Uint8Array> {
  if (salt.length < 16) {
    throwCryptoError('INVALID_SALT', 'KDF', 'Salt must be at least 16 bytes');
  }
  if (password.length === 0) {
    throwCryptoError('INVALID_PARAMETERS', 'KDF', 'Password must not be empty');
  }

  let profile = ARGON2_PROFILES.INTERACTIVE;
  if (options.profile) {
    profile = ARGON2_PROFILES[options.profile];
  }

  const overrides = options.overrides ?? {};
  const iterations = overrides.iterations ?? profile.iterations;
  const memorySizeKiB = overrides.memorySizeKiB ?? profile.memorySizeKiB;
  const parallelism = overrides.parallelism ?? profile.parallelism;
  const hashLength = overrides.hashLength ?? profile.hashLength;

  if (iterations < 1) {
    throwCryptoError('INVALID_PARAMETERS', 'KDF', 'iterations must be >= 1');
  }
  if (memorySizeKiB < 8 * parallelism) {
    throwCryptoError('INVALID_PARAMETERS', 'KDF', 'memorySizeKiB must be >= 8 * parallelism');
  }

  try {
    const result = await argon2id({
      password: password.normalize('NFKC'),
      salt: Array.from(salt).map((b) => String.fromCharCode(b)).join(''),
      iterations,
      memorySizeKiB,
      parallelism,
      hashLength,
      outputType: 'binary',
    });
    return result as unknown as Uint8Array;
  } catch (err) {
    throwCryptoError('DERIVATION_FAILED', 'KDF', `Argon2id derivation failed: ${err}`);
  }
}

/**
 * Generates a fresh Argon2-compliant salt (32 random bytes).
 *
 * RFC 9106 recommends a minimum of 16 bytes; 32 bytes provides
 * maximum resistance against salt-reuse attacks across envelopes.
 *
 * @returns 32 random bytes.
 *
 * @example
 * ```ts
 * const salt = generateArgon2Salt();
 * const key = await deriveKeyArgon2id(password, salt);
 * ```
 */
export function generateArgon2Salt(): Uint8Array {
  return randomBytes(32);
}
