// packages/react/test/headless/context-crypto.spec.ts
import { describe, it, expect } from 'vitest';
import { base64urlDecode } from '@me2em/core';
import {
  deriveCacheKey,
  encryptContext,
  decryptContext,
  type ContextEnvelope,
} from '../../src/headless/context-crypto.js';
import type { IdentityContextData } from '../../src/headless/identity-context-types.js';

function makeData(identityId: string): IdentityContextData {
  return {
    identityId,
    handles: [{ name: 'test-handle', meta: { key: 'value' } }],
    savedAt: 1700000000000,
  };
}

function makeMaterial(n: number): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = (i + n) & 0xff;
  return arr;
}

describe('context-crypto', () => {
  it('encrypt → decrypt roundtrip (data equal)', async () => {
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    const data = makeData('test-id');

    const envelope = await encryptContext(key, data);
    const decrypted = await decryptContext(key, envelope);

    expect(decrypted.identityId).toBe(data.identityId);
    expect(decrypted.handles).toEqual(data.handles);
    expect(decrypted.savedAt).toBe(data.savedAt);
  });

  it('decrypt with different key → rejects', async () => {
    const materialA = makeMaterial(1);
    const materialB = makeMaterial(2);
    const salt = new Uint8Array(32);
    const keyA = await deriveCacheKey(materialA, salt);
    const keyB = await deriveCacheKey(materialB, salt);
    const data = makeData('test-id');

    const envelope = await encryptContext(keyA, data);

    await expect(decryptContext(keyB, envelope)).rejects.toThrow();
  });

  it('v: 2 → Unsupported envelope version', async () => {
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    const badEnvelope: ContextEnvelope = {
      v: 2,
      salt: 'dGVzdA==',
      iv: 'dGVzdA==',
      ct: 'dGVzdA==',
    };

    await expect(decryptContext(key, badEnvelope)).rejects.toThrow('Unsupported envelope version');
  });

  it('two encrypt of same data → different iv/ct, both decrypt with same key', async () => {
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    const data = makeData('test-id');

    const env1 = await encryptContext(key, data);
    const env2 = await encryptContext(key, data);

    // Different IVs and ciphertexts (fresh salt/iv each time)
    expect(env1.iv).not.toBe(env2.iv);
    expect(env1.ct).not.toBe(env2.ct);

    // Both decrypt to the same data
    const d1 = await decryptContext(key, env1);
    const d2 = await decryptContext(key, env2);
    expect(d1).toEqual(d2);
    expect(d1).toEqual(data);
  });

  it('envelope fields are unpadded URL-safe base64 decodable by @me2em/core', async () => {
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    const envelope = await encryptContext(key, makeData('test-id'));

    // Codec contract (R4): envelope persists to IDB, so its fields must stay
    // within the unpadded URL-safe alphabet that base64urlDecode accepts —
    // no `+`, no `/`, no `=` padding.
    const urlSafe = /^[A-Za-z0-9_-]+$/;
    expect(envelope.salt).toMatch(urlSafe);
    expect(envelope.iv).toMatch(urlSafe);
    expect(envelope.ct).toMatch(urlSafe);

    // Byte-length contract survives the codec swap: core's decoder must see
    // exactly the lengths encryptContext produced (iv 12B for AES-GCM,
    // salt 32B, ct = plaintext || 16B GCM tag).
    expect(base64urlDecode(envelope.iv)).toHaveLength(12);
    expect(base64urlDecode(envelope.salt)).toHaveLength(32);
    expect(base64urlDecode(envelope.ct).length).toBeGreaterThanOrEqual(16);
  });
});
