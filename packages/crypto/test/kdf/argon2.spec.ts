// packages/crypto/test/kdf/argon2.spec.ts
import { describe, it, expect } from 'vitest';
import {
  deriveKeyArgon2id,
  generateArgon2Salt,
  ARGON2_PROFILES,
} from '../../src/kdf/argon2.js';
import { CryptoError } from '../../src/errors.js';

describe('generateArgon2Salt', () => {
  it('returns 32 bytes', () => {
    const salt = generateArgon2Salt();
    expect(salt.length).toBe(32);
  });

  it('two calls produce different salts', () => {
    const s1 = generateArgon2Salt();
    const s2 = generateArgon2Salt();
    expect(s2).not.toEqual(s1);
  });
});

describe('deriveKeyArgon2id', () => {
  it('is deterministic: same inputs produce same key', async () => {
    const password = 'test-password';
    const salt = generateArgon2Salt();
    const k1 = await deriveKeyArgon2id(password, salt, { profile: 'INTERACTIVE' });
    const k2 = await deriveKeyArgon2id(password, salt, { profile: 'INTERACTIVE' });
    expect(k2).toEqual(k1);
  });

  it('different salt produces different key', async () => {
    const password = 'test-password';
    const salt1 = generateArgon2Salt();
    const salt2 = generateArgon2Salt();
    const k1 = await deriveKeyArgon2id(password, salt1, { profile: 'INTERACTIVE' });
    const k2 = await deriveKeyArgon2id(password, salt2, { profile: 'INTERACTIVE' });
    expect(k2).not.toEqual(k1);
  });

  it('different password produces different key', async () => {
    const salt = generateArgon2Salt();
    const k1 = await deriveKeyArgon2id('password-A', salt, { profile: 'INTERACTIVE' });
    const k2 = await deriveKeyArgon2id('password-B', salt, { profile: 'INTERACTIVE' });
    expect(k2).not.toEqual(k1);
  });

  it('SENSITIVE profile ≠ INTERACTIVE on same inputs', async () => {
    const password = 'test-password';
    const salt = generateArgon2Salt();
    const kInteractive = await deriveKeyArgon2id(password, salt, { profile: 'INTERACTIVE' });
    const kSensitive = await deriveKeyArgon2id(password, salt, { profile: 'SENSITIVE' });
    expect(kSensitive).not.toEqual(kInteractive);
  });

  it('overrides work: fast profile for unit tests', async () => {
    const password = 'test-password';
    const salt = generateArgon2Salt();
    const k = await deriveKeyArgon2id(password, salt, {
      overrides: { iterations: 1, memorySizeKiB: 8192 },
    });
    expect(k.length).toBe(32);
  });

  it('salt < 16 bytes throws INVALID_SALT', async () => {
    await expect(
      deriveKeyArgon2id('password', new Uint8Array(8), { profile: 'INTERACTIVE' })
    ).rejects.toMatchObject({ code: 'INVALID_SALT', level: 'KDF' });
  });

  it('empty password throws INVALID_PARAMETERS', async () => {
    const salt = generateArgon2Salt();
    await expect(
      deriveKeyArgon2id('', salt, { profile: 'INTERACTIVE' })
    ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS', level: 'KDF' });
  });

  it('NFKC normalization: ligature ﬁ folds to "fi"', async () => {
    const salt = generateArgon2Salt();
    const k1 = await deriveKeyArgon2id('\uFB01le', salt, { profile: 'INTERACTIVE' });
    const k2 = await deriveKeyArgon2id('file', salt, { profile: 'INTERACTIVE' });
    expect(k2).toEqual(k1);
  });

  it('SENSITIVE profile returns 32B key', async () => {
    const password = 'test-password';
    const salt = generateArgon2Salt();
    const k = await deriveKeyArgon2id(password, salt, { profile: 'SENSITIVE' });
    expect(k.length).toBe(32);
  });
});
