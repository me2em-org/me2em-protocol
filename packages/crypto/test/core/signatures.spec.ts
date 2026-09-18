// packages/crypto/test/core/signatures.spec.ts
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  signRaw,
  verifyRaw,
  signRawToBase64,
  verifyRawFromBase64,
} from '../../src/core/signatures.js';
import { CryptoError } from '../../src/errors.js';

function generateKeyPair() {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

describe('signRaw / verifyRaw', () => {
  it('sign then verify roundtrip', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const message = new TextEncoder().encode('test message');
    const sig = signRaw(privateKey, message);
    expect(sig.length).toBe(64);
    expect(verifyRaw(publicKey, message, sig)).toBe(true);
  });

  it('tampered message verification fails', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const message = new TextEncoder().encode('original');
    const sig = signRaw(privateKey, message);
    const tampered = new TextEncoder().encode('tampered!');
    expect(verifyRaw(publicKey, tampered, sig)).toBe(false);
  });

  it('signature from wrong key fails verification', () => {
    const { privateKey: privA, publicKey: pubA } = generateKeyPair();
    const { publicKey: pubB } = generateKeyPair();
    const message = new TextEncoder().encode('hello');
    const sig = signRaw(privA, message);
    expect(verifyRaw(pubB, message, sig)).toBe(false);
  });

  it('short signature returns false, not throw', () => {
    const { publicKey } = generateKeyPair();
    expect(verifyRaw(publicKey, new Uint8Array(4), new Uint8Array(10))).toBe(false);
  });

  it('wrong key length throws', () => {
    expect(() => signRaw(new Uint8Array(16), new Uint8Array(4))).toThrow(CryptoError);
  });
});

describe('signRawToBase64 / verifyRawFromBase64', () => {
  it('roundtrip via base64', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const message = new TextEncoder().encode('b64 test');
    const sigB64 = signRawToBase64(privateKey, message);
    expect(typeof sigB64).toBe('string');
    expect(verifyRawFromBase64(publicKey, message, sigB64)).toBe(true);
  });

  it('tampered base64 signature fails', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const message = new TextEncoder().encode('data');
    const sigB64 = signRawToBase64(privateKey, message);
    // Flip a character
    const tampered = sigB64.slice(0, 5) + (sigB64[5] === 'A' ? 'B' : 'A') + sigB64.slice(6);
    expect(verifyRawFromBase64(publicKey, message, tampered)).toBe(false);
  });
});
