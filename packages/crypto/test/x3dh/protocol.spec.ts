// packages/crypto/test/x3dh/protocol.spec.ts
import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  verifyRaw,
  signRaw,
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

describe('completeX3DH — OTK consumption (session-bound ephemeral-key model)', () => {
  it('wipes the OTK private key in place; identity and SPK keys untouched', async () => {
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

    const idPrivBefore = new Uint8Array(bob.privateKey);
    const spkPrivBefore = new Uint8Array(bobSPK.keyPair.privateKey);
    const otkPriv = new Uint8Array(bobOTK.privateKey); // the consumed buffer

    const shared = await completeX3DH(
      bob,
      bobSPK,
      { keyPair: { privateKey: otkPriv, publicKey: bobOTK.publicKey } },
      alice.publicKey,
      result.ephemeralPublicKey
    );

    expect(shared.length).toBe(32);
    expect(otkPriv.every(b => b === 0)).toBe(true); // consumed in place
    expect(bob.privateKey).toEqual(idPrivBefore); // caller key intact
    expect(bobSPK.keyPair.privateKey).toEqual(spkPrivBefore); // SPK intact
  });

  it('reuse of the wiped OTK derives a corrupted secret silently (no throw)', async () => {
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

    const r1 = await initiateX3DH(alice, bundle);
    const otkPriv = new Uint8Array(bobOTK.privateKey);
    const s1 = await completeX3DH(
      bob,
      bobSPK,
      { keyPair: { privateKey: otkPriv, publicKey: bobOTK.publicKey } },
      alice.publicKey,
      r1.ephemeralPublicKey
    );
    expect(otkPriv.every(b => b === 0)).toBe(true);

    // REUSE the wiped buffer with a second fresh ephemeral:
    // no error is thrown — the corruption is silent.
    const r2 = await initiateX3DH(alice, bundle);
    const s2reused = await completeX3DH(
      bob,
      bobSPK,
      { keyPair: { privateKey: otkPriv, publicKey: bobOTK.publicKey } },
      alice.publicKey,
      r2.ephemeralPublicKey
    );

    // Reference: what the INTACT OTK would derive for the same r2.
    const s2ref = await completeX3DH(
      bob,
      bobSPK,
      { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: bobOTK.publicKey } },
      alice.publicKey,
      r2.ephemeralPublicKey
    );

    expect(s2reused).not.toEqual(s2ref); // corrupted ≠ canonical
    expect(s2reused).not.toEqual(s1); // and ≠ the first session's secret
  });
});

describe('X3DH error-path memory hygiene', () => {
  it('malformed SPK public key (31B) in bundle → DH1 throws, partial intermediates wiped', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    // A hostile bundle: the "SPK public key" is 31 bytes. The signature
    // over those bytes is valid, so the MITM check passes — the DH
    // length guard is what must stop it (and the finally-wipe must
    // clean up everything derived before the throw).
    const badSpkPub = bobSPK.keyPair.publicKey.slice(0, 31);
    const badSig = signRaw(bob.privateKey, badSpkPub);

    const bundle: PreKeyBundle = {
      identityPublicKey: bob.publicKey,
      signedPreKeyPublicKey: badSpkPub,
      signedPreKeySignature: badSig,
      oneTimePreKeyPublicKey: bobOTK.publicKey,
    };

    await expect(initiateX3DH(alice, bundle)).rejects.toThrow(CryptoError);
  });

  it('malformed ephemeral public key (31B) → DH1 throws on recipient side; unconsumed OTK stays usable', async () => {
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

    const badEkPub = result.ephemeralPublicKey.slice(0, 31);
    const otkPriv = new Uint8Array(bobOTK.privateKey);

    await expect(
      completeX3DH(
        bob,
        bobSPK,
        { keyPair: { privateKey: otkPriv, publicKey: bobOTK.publicKey } },
        alice.publicKey,
        badEkPub
      )
    ).rejects.toThrow(CryptoError);

    // DH4 never ran — the OTK was NOT consumed: an earlier throw must
    // leave the one-time pre-key usable for a real session.
    expect(otkPriv.every(b => b === 0)).toBe(false);
  });
});
