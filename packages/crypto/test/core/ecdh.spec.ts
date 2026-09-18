// packages/crypto/test/core/ecdh.spec.ts
import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  x25519SharedSecret,
  ed25519PrivToX25519,
  deriveX25519PublicKey,
} from '../../src/core/ecdh.js';
import { CryptoError } from '../../src/errors.js';

describe('generateX25519KeyPair', () => {
  it('produces 32-byte privateKey and publicKey', () => {
    const { privateKey, publicKey } = generateX25519KeyPair();
    expect(privateKey.length).toBe(32);
    expect(publicKey.length).toBe(32);
  });

  it('publicKey is deterministically derived from privateKey', () => {
    const { privateKey, publicKey } = generateX25519KeyPair();
    const derived = deriveX25519PublicKey(privateKey);
    expect(derived).toEqual(publicKey);
  });
});

describe('x25519SharedSecret', () => {
  it('returns 32-byte shared secret (NOT 31 — no slice(1) bug)', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const shared = x25519SharedSecret(alice.privateKey, bob.publicKey);
    expect(shared.length).toBe(32);
  });

  it('is symmetric: A shared with B pub = B shared with A pub', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const s1 = x25519SharedSecret(alice.privateKey, bob.publicKey);
    const s2 = x25519SharedSecret(bob.privateKey, alice.publicKey);
    expect(s2).toEqual(s1);
  });

  it('throws INVALID_LENGTH for wrong key sizes', () => {
    const alice = generateX25519KeyPair();
    expect(() => x25519SharedSecret(new Uint8Array(16), alice.publicKey)).toThrow(CryptoError);
    expect(() => x25519SharedSecret(alice.privateKey, new Uint8Array(16))).toThrow(CryptoError);
    expect(() => x25519SharedSecret(new Uint8Array(33), alice.publicKey)).toThrow(CryptoError);
  });
});

describe('ed25519PrivToX25519', () => {
  it('is deterministic', () => {
    const key = new Uint8Array(32).fill(0x42);
    const r1 = ed25519PrivToX25519(key);
    const r2 = ed25519PrivToX25519(key);
    expect(r2).toEqual(r1);
  });

  it('returns 32-byte output', () => {
    const key = new Uint8Array(32).fill(0x42);
    const x = ed25519PrivToX25519(key);
    expect(x.length).toBe(32);
  });

  it('throws for wrong input length', () => {
    expect(() => ed25519PrivToX25519(new Uint8Array(16))).toThrow(CryptoError);
  });
});

describe('deriveX25519PublicKey', () => {
  it('produces 32-byte public key', () => {
    const priv = new Uint8Array(32).fill(0x42);
    const pub = deriveX25519PublicKey(priv);
    expect(pub.length).toBe(32);
  });
});
