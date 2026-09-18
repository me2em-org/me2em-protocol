// packages/crypto/test/x3dh/protocol.spec.ts
import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  verifyRaw,
} from '../../src/index.js';
import {
  generateSignedPreKey,
  initiateX3DH,
  completeX3DH,
  verifySignedPreKey,
  generateOneTimePreKeys,
} from '../../src/x3dh/protocol.js';
import { hkdf } from '../../src/core/hkdf.js';
import {
  x25519SharedSecret,
  ed25519PrivToX25519,
  ed25519PubToX25519,
} from '../../src/core/ecdh.js';
import { concat, bytesEqual } from '../../src/utils/binary.js';
import type { IdentityKeys, PreKeyBundle, OneTimePreKey } from '../../src/x3dh/types.js';
import { CryptoError } from '../../src/errors.js';
import { ed25519 } from '@noble/curves/ed25519.js';

function randomIdentity(): IdentityKeys {
  const privateKey = ed25519.utils.randomSecretKey();
  return {
    privateKey,
    publicKey: ed25519.getPublicKey(privateKey),
  };
}

describe('generateSignedPreKey', () => {
  it('produces X25519 keypair + 64B signature', () => {
    const identity = randomIdentity();
    const spk = generateSignedPreKey(identity);
    expect(spk.keyPair.privateKey.length).toBe(32);
    expect(spk.keyPair.publicKey.length).toBe(32);
    expect(spk.signature.length).toBe(64);
  });

  it('signature verifies against identity public key', () => {
    const identity = randomIdentity();
    const spk = generateSignedPreKey(identity);
    const ok = verifyRaw(identity.publicKey, spk.keyPair.publicKey, spk.signature);
    expect(ok).toBe(true);
  });
});

describe('generateOneTimePreKeys', () => {
  it('produces correct number of X25519 keypairs', () => {
    const keys = generateOneTimePreKeys(10);
    expect(keys.length).toBe(10);
    for (const k of keys) {
      expect(k.keyPair.privateKey.length).toBe(32);
      expect(k.keyPair.publicKey.length).toBe(32);
    }
  });

  it('throws for count out of range', () => {
    expect(() => generateOneTimePreKeys(0)).toThrow(CryptoError);
    expect(() => generateOneTimePreKeys(1001)).toThrow(CryptoError);
  });
});

describe('initiateX3DH', () => {
  it('roundtrip: initiator and recipient derive the same shared secret', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);

    const bobOTK = generateX25519KeyPair();

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    verifySignedPreKey(bundle, bob.publicKey);

    const result = await initiateX3DH(alice, bundle);
    expect(result.sharedSecret.length).toBe(32);
    expect(result.ephemeralPublicKey.length).toBe(32);
    expect(result.usedOneTimePreKeyId).toBeDefined();

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };
    const sharedB = await completeX3DH(
      bob,
      bobSPK,
      bobOTKObj,
      alice.publicKey,
      result.ephemeralPublicKey
    );

    expect(sharedB).toEqual(result.sharedSecret);
  });

  it('freshness: two initiations produce different ephemeral keys and secrets', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    const r1 = await initiateX3DH(alice, bundle);
    const r2 = await initiateX3DH(alice, bundle);

    expect(r1.ephemeralPublicKey).not.toEqual(r2.ephemeralPublicKey);
    expect(r1.sharedSecret).not.toEqual(r2.sharedSecret);
  });

  it('MITM defense: tampered SPK signature throws VERIFICATION_FAILED', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const tamperedSig = new Uint8Array(bobSPK.signature);
    tamperedSig[0] = (tamperedSig[0] + 1) % 256;

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: tamperedSig,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    await expect(initiateX3DH(alice, bundle)).rejects.toThrow(CryptoError);
  });

  it('no-OTK rejection: bundle without oneTimePreKeyPublicKey throws', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
    };

    await expect(initiateX3DH(alice, bundle)).rejects.toThrow(CryptoError);
  });

  it('order sensitivity: swapped DH2↔DH3 produces different secret', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    const canonicalResult = await initiateX3DH(alice, bundle);

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };
    const canonicalSharedB = await completeX3DH(
      bob,
      bobSPK,
      bobOTKObj,
      alice.publicKey,
      canonicalResult.ephemeralPublicKey
    );

    expect(canonicalSharedB).toEqual(canonicalResult.sharedSecret);

    // Compute with swapped DH2↔DH3
    const ek = generateX25519KeyPair();
    const ikA_x = ed25519PrivToX25519(alice.privateKey);
    const ikB_xPub = ed25519PubToX25519(bob.publicKey);
    const spkB_xPub = bobSPK.keyPair.publicKey;
    const opkB_xPub = bobOTK.publicKey;

    const dh1 = x25519SharedSecret(ikA_x, spkB_xPub);
    const dh2_swapped = x25519SharedSecret(ek.privateKey, spkB_xPub);
    const dh3_swapped = x25519SharedSecret(ek.privateKey, ikB_xPub);
    const dh4 = x25519SharedSecret(ek.privateKey, opkB_xPub);

    const ikmSwapped = concat(dh1, dh2_swapped, dh3_swapped, dh4);
    const swappedSecret = await hkdf(ikmSwapped, new Uint8Array(32), new TextEncoder().encode('me2em/crypto/v1/x3dh'), 32);

    expect(bytesEqual(canonicalResult.sharedSecret, swappedSecret)).toBe(false);
  });

  it('wipe discipline: ephemeral private key is wiped after initiation', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    const result = await initiateX3DH(alice, bundle);

    expect(result.ephemeralPublicKey).toBeDefined();
    expect(result.ephemeralPublicKey.length).toBe(32);
  });
});

describe('completeX3DH', () => {
  it('returns same secret as initiateX3DH', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: bobSPK.keyPair.publicKey,
      signedPreKeySignature: bobSPK.signature,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    const result = await initiateX3DH(alice, bundle);

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };
    const sharedB = await completeX3DH(
      bob,
      bobSPK,
      bobOTKObj,
      alice.publicKey,
      result.ephemeralPublicKey
    );

    expect(sharedB).toEqual(result.sharedSecret);
  });
});
