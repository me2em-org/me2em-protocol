// packages/react/test/headless/identity-context-storage.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IdentityContextIDBStorage } from '../../src/headless/identity-context-storage.js';
import { deriveCacheKey } from '../../src/headless/context-crypto.js';
import type { IdentityContextData } from '../../src/headless/identity-context-types.js';

const ID_A = 'identity-alpha-pubkey';
const ID_B = 'identity-beta-pubkey';

function makeData(identityId: string): IdentityContextData {
  return {
    identityId,
    handles: [{ name: 'handle-a', subHandles: ['sub-1'], meta: { foo: 'bar' } }],
    savedAt: 1700000000000,
  };
}

function makeMaterial(n: number): Uint8Array {
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = (i + n) & 0xff;
  return arr;
}

describe('IdentityContextIDBStorage', () => {
  let storage: IdentityContextIDBStorage;

  beforeEach(() => {
    storage = new IdentityContextIDBStorage();
  });

  afterEach(async () => {
    try {
      await storage.close();
    } catch { /* already closed */ }
  });

  it('save → load returns equal data', async () => {
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(ID_A);
    const data = makeData(ID_A);
    await storage.save(data);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.identityId).toBe(ID_A);
    expect(loaded!.handles).toEqual(data.handles);
    expect(loaded!.savedAt).toBe(data.savedAt);
  });

  it('load without save → null', async () => {
    const material = makeMaterial(2);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(ID_A);
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('clear → load → null', async () => {
    const material = makeMaterial(3);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(ID_A);
    await storage.save(makeData(ID_A));
    await storage.clear();
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('save → close → open(same identityId) → load returns data (persist)', async () => {
    const material = makeMaterial(4);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    await storage.open(ID_A);
    storage.setCacheKey(key);
    await storage.save(makeData(ID_A));
    await storage.close();

    const storage2 = new IdentityContextIDBStorage();
    storage2.setCacheKey(key);
    await storage2.open(ID_A);
    const loaded = await storage2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.identityId).toBe(ID_A);
    await storage2.close();
  });

  it('open(identityIdB) after open(identityIdA) → load → null (ISOLATION)', async () => {
    const materialA = makeMaterial(5);
    const materialB = makeMaterial(6);
    const saltA = new Uint8Array(32);
    const saltB = new Uint8Array(32);
    const keyA = await deriveCacheKey(materialA, saltA);
    const keyB = await deriveCacheKey(materialB, saltB);

    await storage.open(ID_A);
    storage.setCacheKey(keyA);
    await storage.save(makeData(ID_A));
    // Switch to different identity
    await storage.open(ID_B);
    storage.setCacheKey(keyB);
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('both envelopes exist in parallel: open A → data A; open B → data B; open A → data A', async () => {
    const materialA = makeMaterial(7);
    const materialB = makeMaterial(8);
    const saltA = new Uint8Array(32);
    const saltB = new Uint8Array(32);
    const keyA = await deriveCacheKey(materialA, saltA);
    const keyB = await deriveCacheKey(materialB, saltB);

    const storageA = new IdentityContextIDBStorage();
    const storageB = new IdentityContextIDBStorage();

    await storageA.open(ID_A);
    storageA.setCacheKey(keyA);
    await storageA.save(makeData(ID_A));

    await storageB.open(ID_B);
    storageB.setCacheKey(keyB);
    await storageB.save(makeData(ID_B));

    // A has A data
    const dataA = await storageA.load();
    expect(dataA).not.toBeNull();
    expect(dataA!.identityId).toBe(ID_A);

    // B has B data
    const dataB = await storageB.load();
    expect(dataB).not.toBeNull();
    expect(dataB!.identityId).toBe(ID_B);

    // Back to A — still has A data
    const dataA2 = await storageA.load();
    expect(dataA2).not.toBeNull();
    expect(dataA2!.identityId).toBe(ID_A);

    await storageA.close();
    await storageB.close();
  });
});
