// packages/crypto/test/envelopes/key-wrapping.spec.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateX25519KeyPair } from '../../src/index.js';
import * as wipeNs from '../../src/core/wipe.js';
import * as aeadNs from '../../src/core/aead.js';
import { generateSignedPreKey, verifySignedPreKey } from '../../src/x3dh/protocol.js';
import {
  wrapKeyForRecipient,
  unwrapKeyForMe,
} from '../../src/envelopes/key-wrapping.js';
import type { PreKeyBundle, IdentityKeys, OneTimePreKey } from '../../src/x3dh/types.js';
import { CryptoError } from '../../src/errors.js';
import { ed25519 } from '@noble/curves/ed25519.js';

function randomIdentity(): IdentityKeys {
  const privateKey = ed25519.utils.randomSecretKey();
  return {
    privateKey,
    publicKey: ed25519.getPublicKey(privateKey),
  };
}

function makeBundle(identity: IdentityKeys, spk: ReturnType<typeof generateSignedPreKey>, otkPub: Uint8Array): PreKeyBundle {
  return {
    identityPublicKey: identity.publicKey,
    signedPreKeyPublicKey: spk.keyPair.publicKey,
    signedPreKeySignature: spk.signature,
    oneTimePreKeyPublicKey: otkPub,
  };
}

describe('wrapKeyForRecipient', () => {
  it('roundtrip: Alice wraps, Bob unwraps, keys match', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);
    verifySignedPreKey(bundle, bob.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const groupId = 'test-group-42';
    const contextSalt = new TextEncoder().encode(groupId);

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    expect(wrapped.v).toBe(1);
    expect(wrapped.wrappedKey.length).toBe(32 + 16); // 32 bytes + 16 GCM tag
    expect(wrapped.iv.length).toBe(12);
    expect(wrapped.ephemeralPublicKey.length).toBe(32);
    expect(wrapped.initiatorIdentityPublicKey.length).toBe(32);
    expect(wrapped.usedOneTimePreKeyId).toBeDefined();

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };
    const unwrapped = await unwrapKeyForMe({
      wrapped,
      myIdentity: bob,
      mySignedPreKey: bobSPK,
      myOneTimePreKey: bobOTKObj,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    expect(unwrapped).toEqual(groupKey);
  });

  it('wrong recipient identity → DECRYPTION_FAILED', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();
    const charlie = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);
    verifySignedPreKey(bundle, bob.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const contextSalt = new TextEncoder().encode('test-group');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    const charlieOTK = generateX25519KeyPair();
    const charlieSPK = generateSignedPreKey(charlie);
    const charlieOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(charlieOTK.privateKey), publicKey: new Uint8Array(charlieOTK.publicKey) } };

    await expect(
      unwrapKeyForMe({
        wrapped,
        myIdentity: charlie,
        mySignedPreKey: charlieSPK,
        myOneTimePreKey: charlieOTKObj,
        contextSalt,
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow(CryptoError);
  });

  it('different contextSalt → DECRYPTION_FAILED', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const wrapSalt = new TextEncoder().encode('group-A');
    const unwrapSalt = new TextEncoder().encode('group-B');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt: wrapSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };

    await expect(
      unwrapKeyForMe({
        wrapped,
        myIdentity: bob,
        mySignedPreKey: bobSPK,
        myOneTimePreKey: bobOTKObj,
        contextSalt: unwrapSalt,
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow(CryptoError);
  });

  it('different info → DECRYPTION_FAILED', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const contextSalt = new TextEncoder().encode('group-A');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };

    await expect(
      unwrapKeyForMe({
        wrapped,
        myIdentity: bob,
        mySignedPreKey: bobSPK,
        myOneTimePreKey: bobOTKObj,
        contextSalt,
        info: 'me2em/crypto/v1/file-key',
      })
    ).rejects.toThrow(CryptoError);
  });

  it('envelope is self-contained: unwrap uses only WrappedKey + recipient private keys', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const contextSalt = new TextEncoder().encode('self-contained-test');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    // Do NOT pass bundle to unwrap — only the wrapped envelope + Bob's private keys
    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };
    const unwrapped = await unwrapKeyForMe({
      wrapped,
      myIdentity: bob,
      mySignedPreKey: bobSPK,
      myOneTimePreKey: bobOTKObj,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    expect(unwrapped).toEqual(groupKey);
  });

  it('tamper wrappedKey (1 byte) → DECRYPTION_FAILED', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const contextSalt = new TextEncoder().encode('tamper-test');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    // Tamper with wrapped key
    const tampered = { ...wrapped, wrappedKey: new Uint8Array(wrapped.wrappedKey) };
    tampered.wrappedKey[0] = (tampered.wrappedKey[0] + 1) % 256;

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };

    await expect(
      unwrapKeyForMe({
        wrapped: tampered,
        myIdentity: bob,
        mySignedPreKey: bobSPK,
        myOneTimePreKey: bobOTKObj,
        contextSalt,
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow(CryptoError);
  });

  it('invalid key length → INVALID_LENGTH', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const tooShort = new Uint8Array(16);

    await expect(
      wrapKeyForRecipient({
        keyBytes: tooShort,
        recipientBundle: bundle,
        myIdentity: alice,
        contextSalt: new TextEncoder().encode('test'),
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow(CryptoError);
  });
});

describe('memory hygiene on error paths (M1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypt failure → wrapKey + sharedSecret wiped (wrapKeyForRecipient)', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);
    verifySignedPreKey(bundle, bob.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const wipeSpy = vi.spyOn(wipeNs, 'secureWipe');
    let wipeCallsAtEncrypt = 0;
    vi.spyOn(globalThis.crypto.subtle, 'encrypt').mockImplementation(
      async (..._args: Parameters<typeof globalThis.crypto.subtle.encrypt>) => {
        wipeCallsAtEncrypt = wipeSpy.mock.calls.length;
        throw new Error('boom — simulated WebCrypto encrypt failure');
      }
    );

    await expect(
      wrapKeyForRecipient({
        keyBytes: groupKey,
        recipientBundle: bundle,
        myIdentity: alice,
        contextSalt: new TextEncoder().encode('wipe-test'),
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow('boom');

    // Exactly two wipes must run on the error path AFTER the encrypt
    // failure: the derived wrapKey (inner finally) and the X3DH shared
    // secret (outer finally). The spy calls through, so both buffers
    // must be zeroed by the time we inspect them.
    const errorPathWipes = wipeSpy.mock.calls.slice(wipeCallsAtEncrypt);
    expect(errorPathWipes.length).toBe(2);
    const [wrapKeyBuf, sharedSecretBuf] = errorPathWipes.map(([b]) => b);
    expect(wrapKeyBuf.length).toBe(32);
    expect(sharedSecretBuf.length).toBe(32);
    expect(wrapKeyBuf.every(b => b === 0)).toBe(true);
    expect(sharedSecretBuf.every(b => b === 0)).toBe(true);
    expect(wrapKeyBuf).not.toBe(sharedSecretBuf);
  });

  it('DECRYPTION_FAILED → wrapKey + sharedSecret wiped (unwrapKeyForMe)', async () => {
    const alice = randomIdentity();
    const bob = randomIdentity();

    const bobSPK = generateSignedPreKey(bob);
    const bobOTK = generateX25519KeyPair();

    const bundle = makeBundle(bob, bobSPK, bobOTK.publicKey);

    const groupKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) groupKey[i] = i;

    const contextSalt = new TextEncoder().encode('wipe-unwrap-test');

    const wrapped = await wrapKeyForRecipient({
      keyBytes: groupKey,
      recipientBundle: bundle,
      myIdentity: alice,
      contextSalt,
      info: 'me2em/crypto/v1/group-key',
    });

    // Tamper one ciphertext byte → GCM auth failure → DECRYPTION_FAILED
    const tampered = { ...wrapped, wrappedKey: new Uint8Array(wrapped.wrappedKey) };
    tampered.wrappedKey[0] = (tampered.wrappedKey[0] + 1) % 256;

    const bobOTKObj: OneTimePreKey = { keyPair: { privateKey: new Uint8Array(bobOTK.privateKey), publicKey: new Uint8Array(bobOTK.publicKey) } };

    const wipeSpy = vi.spyOn(wipeNs, 'secureWipe');
    const decryptOriginal = aeadNs.decryptAead;
    let wipeCallsAtDecrypt = 0;
    vi.spyOn(aeadNs, 'decryptAead').mockImplementation(
      async (key, ciphertext, iv) => {
        wipeCallsAtDecrypt = wipeSpy.mock.calls.length;
        return decryptOriginal(key, ciphertext, iv);
      }
    );

    await expect(
      unwrapKeyForMe({
        wrapped: tampered,
        myIdentity: bob,
        mySignedPreKey: bobSPK,
        myOneTimePreKey: bobOTKObj,
        contextSalt,
        info: 'me2em/crypto/v1/group-key',
      })
    ).rejects.toThrow(CryptoError);

    // completeX3DH's own wipes happened before decryptAead ran; on the
    // DECRYPTION_FAILED path exactly two more wipes must run: the
    // wrapKey (inner finally) then the shared secret (outer finally).
    const errorPathWipes = wipeSpy.mock.calls.slice(wipeCallsAtDecrypt);
    expect(errorPathWipes.length).toBe(2);
    const [wrapKeyBuf, sharedSecretBuf] = errorPathWipes.map(([b]) => b);
    expect(wrapKeyBuf.length).toBe(32);
    expect(sharedSecretBuf.length).toBe(32);
    expect(wrapKeyBuf.every(b => b === 0)).toBe(true);
    expect(sharedSecretBuf.every(b => b === 0)).toBe(true);
    expect(wrapKeyBuf).not.toBe(sharedSecretBuf);
  });
});
