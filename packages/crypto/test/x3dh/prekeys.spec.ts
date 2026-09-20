// packages/crypto/test/x3dh/prekeys.spec.ts
import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair, verifyRaw } from '../../src/index.js';
import { generatePreKeyBatch, publishableBundle } from '../../src/x3dh/prekeys.js';
import { CryptoError } from '../../src/errors.js';
import { ed25519 } from '@noble/curves/ed25519.js';

function randomIdentity() {
  const privateKey = ed25519.utils.randomSecretKey();
  return {
    privateKey,
    publicKey: ed25519.getPublicKey(privateKey),
  };
}

describe('generatePreKeyBatch', () => {
  it('produces 1 SPK + N OTKs with 32-byte keys', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 100);

    expect(batch.signedPreKey.keyPair.privateKey.length).toBe(32);
    expect(batch.signedPreKey.keyPair.publicKey.length).toBe(32);
    expect(batch.signedPreKey.signature.length).toBe(64);
    expect(batch.oneTimePreKeys.length).toBe(100);
    for (const otk of batch.oneTimePreKeys) {
      expect(otk.keyPair.privateKey.length).toBe(32);
      expect(otk.keyPair.publicKey.length).toBe(32);
    }
  });

  it('SPK signature validates against identity pubkey', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 10);
    const ok = verifyRaw(
      identity.publicKey,
      batch.signedPreKey.keyPair.publicKey,
      batch.signedPreKey.signature
    );
    expect(ok).toBe(true);
  });

  it('different identities produce different SPKs', () => {
    const id1 = randomIdentity();
    const id2 = randomIdentity();
    const batch1 = generatePreKeyBatch(id1, 5);
    const batch2 = generatePreKeyBatch(id2, 5);
    expect(batch1.signedPreKey.keyPair.publicKey).not.toEqual(batch2.signedPreKey.keyPair.publicKey);
  });

  it('otkCount > 1000 throws INVALID_ARGUMENT', () => {
    const identity = randomIdentity();
    expect(() => generatePreKeyBatch(identity, 1001)).toThrow(CryptoError);
  });

  it('otkCount < 1 throws INVALID_ARGUMENT', () => {
    const identity = randomIdentity();
    expect(() => generatePreKeyBatch(identity, 0)).toThrow(CryptoError);
  });

  it('oneTimePreKeyPublicB64 has correct count', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 50);
    expect(batch.oneTimePreKeyPublicB64.length).toBe(50);
    for (const b64 of batch.oneTimePreKeyPublicB64) {
      expect(typeof b64).toBe('string');
      expect(b64.length).toBeGreaterThan(0);
    }
  });
});

describe('publishableBundle', () => {
  it('fields match PreKeyBundle shape', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 10);
    const bundle = publishableBundle(batch, identity.publicKey);

    expect(bundle.identityPublicKey).toEqual(identity.publicKey);
    expect(bundle.signedPreKeyPublicKey).toEqual(batch.signedPreKey.keyPair.publicKey);
    expect(bundle.signedPreKeySignature).toEqual(batch.signedPreKey.signature);
    expect(bundle.oneTimePreKeyPublicKey).toBeUndefined();
  });

  it('with OTK index: includes the correct OTK public key', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 20);
    const bundle = publishableBundle(batch, identity.publicKey, 7);

    expect(bundle.oneTimePreKeyPublicKey).toEqual(batch.oneTimePreKeys[7].keyPair.publicKey);
  });

  it('out-of-range OTK index throws', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 10);
    expect(() => publishableBundle(batch, identity.publicKey, 99)).toThrow(CryptoError);
  });

  it('negative OTK index throws', () => {
    const identity = randomIdentity();
    const batch = generatePreKeyBatch(identity, 10);
    expect(() => publishableBundle(batch, identity.publicKey, -1)).toThrow(CryptoError);
  });
});
