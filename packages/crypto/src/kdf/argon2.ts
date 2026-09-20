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

export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  profile: string
): Promise<DeriveKeyResult> {
  const p = ARGON2_PROFILES[profile];
  if (!p) {
    throwCryptoError('INVALID_ARGUMENT', 'FORMAT', `Unknown Argon2 profile: ${profile}`);
  }

  const hash = await argon2id({
    password,
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

export async function verifyArgon2(
  password: string,
  encodedHash: string,
  secret?: string
): Promise<boolean> {
  return argon2Verify({ password, hash: encodedHash, secret });
}
