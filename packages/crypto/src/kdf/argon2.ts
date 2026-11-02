// packages/crypto/src/kdf/argon2.ts
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from '../utils/binary.js';
import { throwCryptoError } from '../errors.js';

export interface Argon2Profile {
  iterations: number;
  memory: number;
  parallelism: number;
  saltBytes: number;
  hashBytes: number;
}

export const ARGON2_PROFILES: Record<string, Argon2Profile> = {
  INTERACTIVE: {
    iterations: 3,
    memory: 1 << 16,
    parallelism: 4,
    saltBytes: 16,
    hashBytes: 32,
  },
  SENSITIVE: {
    iterations: 4,
    memory: 1 << 18,
    parallelism: 1,
    saltBytes: 32,
    hashBytes: 64,
  },
};

export interface DeriveKeyResult {
  key: Uint8Array;
  salt: Uint8Array;
  profile: string;
  params: {
    iterations: number;
    memory: number;
    parallelism: number;
  };
}

/**
 * Derives a key from a password with Argon2id under the given profile.
 *
 * The `password` is NFKC-normalized before hashing (consistent with
 * `@me2em/core` name/context canonicalization). Callers SHOULD still
 * normalize UI input for display, but hashing is canonical — the same
 * logical password in different Unicode forms (e.g. the ligature
 * `ﬁ` vs `fi`, precomposed vs decomposed accents) produces the
 * SAME key. BREAKING vs earlier versions: hashes produced before
 * NFKC normalization was introduced will not verify — re-derive.
 *
 * @param password - The human password (any Unicode form; NFKC-folded
 *   internally before hashing).
 * @param salt - Salt bytes (see {@link generateArgon2Salt} for the
 *   profile-appropriate size).
 * @param profile - One of {@link ARGON2_PROFILES} keys (`INTERACTIVE`,
 *   `SENSITIVE`).
 * @returns The derived key, the salt, the profile name and the
 *   effective parameters.
 * @throws {CryptoError} `INVALID_ARGUMENT` if the profile is unknown.
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  profile: string
): Promise<DeriveKeyResult> {
  const p = ARGON2_PROFILES[profile];
  if (!p) {
    throwCryptoError('INVALID_ARGUMENT', 'FORMAT', `Unknown Argon2 profile: ${profile}`);
  }

  const normalizedPassword = password.normalize('NFKC');
  const hash = await argon2id({
    password: normalizedPassword,
    salt,
    iterations: p.iterations,
    memorySize: p.memory,
    parallelism: p.parallelism,
    hashLength: p.hashBytes,
    outputType: 'binary',
  });

  return {
    key: hash,
    salt,
    profile,
    params: {
      iterations: p.iterations,
      memory: p.memory,
      parallelism: p.parallelism,
    },
  };
}

export function generateArgon2Salt(profile: string): Uint8Array {
  const p = ARGON2_PROFILES[profile];
  if (!p) {
    throwCryptoError('INVALID_ARGUMENT', 'FORMAT', `Unknown Argon2 profile: ${profile}`);
  }
  return randomBytes(p.saltBytes);
}

/**
 * Verifies a password against an encoded Argon2id hash.
 *
 * The `password` is NFKC-normalized before verification — the same
 * canonicalization {@link deriveKeyArgon2id} applies, so hashes and
 * verification always agree on Unicode forms.
 *
 * @param password - The candidate password (NFKC-folded internally).
 * @param encodedHash - The encoded Argon2id hash (PHC string format).
 * @param secret - Optional additional secret data passed through to
 *   Argon2id (not normalized).
 * @returns true if the password matches, false otherwise.
 */
export async function verifyArgon2(
  password: string,
  encodedHash: string,
  secret?: string
): Promise<boolean> {
  return argon2Verify({ password: password.normalize('NFKC'), hash: encodedHash, secret });
}
