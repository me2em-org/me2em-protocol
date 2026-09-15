// packages/react/test/headless/identity-context-storage.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IdentityContextIDBStorage } from '../../src/headless/identity-context-storage.js';
import { deriveCacheKey } from '../../src/headless/context-crypto.js';
import type { IdentityContextData } from '../../src/headless/identity-context-types.js';

let idCounter = 0;
function makeId(): string {
  return `identity-test-${++idCounter}`;
}
const ID_A = makeId();
const ID_B = makeId();

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
    const id = makeId();
    const material = makeMaterial(1);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(id);
    const data = makeData(id);
    await storage.save(data);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.identityId).toBe(id);
    expect(loaded!.handles).toEqual(data.handles);
    expect(loaded!.savedAt).toBe(data.savedAt);
  });

  it('load without save → null', async () => {
    const id = makeId();
    const material = makeMaterial(2);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(id);
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('clear → load → null', async () => {
    const id = makeId();
    const material = makeMaterial(3);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);
    storage.setCacheKey(key);

    await storage.open(id);
    await storage.save(makeData(id));
    await storage.clear();
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('save → close → open(same identityId) → load returns data (persist)', async () => {
    const id = makeId();
    const material = makeMaterial(4);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    await storage.open(id);
    storage.setCacheKey(key);
    await storage.save(makeData(id));
    await storage.close();

    const storage2 = new IdentityContextIDBStorage();
    storage2.setCacheKey(key);
    await storage2.open(id);
    const loaded = await storage2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.identityId).toBe(id);
    await storage2.close();
  });

  it('open(identityIdB) after open(identityIdA) → load → null (ISOLATION)', async () => {
    const idA = makeId();
    const idB = makeId();
    const materialA = makeMaterial(5);
    const materialB = makeMaterial(6);
    const saltA = new Uint8Array(32);
    const saltB = new Uint8Array(32);
    const keyA = await deriveCacheKey(materialA, saltA);
    const keyB = await deriveCacheKey(materialB, saltB);

    await storage.open(idA);
    storage.setCacheKey(keyA);
    await storage.save(makeData(idA));
    // Switch to different identity
    await storage.open(idB);
    storage.setCacheKey(keyB);
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it('both envelopes exist in parallel: open A → data A; open B → data B; open A → data A', async () => {
    const idA = makeId();
    const idB = makeId();
    const materialA = makeMaterial(7);
    const materialB = makeMaterial(8);
    const saltA = new Uint8Array(32);
    const saltB = new Uint8Array(32);
    const keyA = await deriveCacheKey(materialA, saltA);
    const keyB = await deriveCacheKey(materialB, saltB);

    const storageA = new IdentityContextIDBStorage();
    const storageB = new IdentityContextIDBStorage();

    await storageA.open(idA);
    storageA.setCacheKey(keyA);
    await storageA.save(makeData(idA));

    await storageB.open(idB);
    storageB.setCacheKey(keyB);
    await storageB.save(makeData(idB));

    // A has A data
    const dataA = await storageA.load();
    expect(dataA).not.toBeNull();
    expect(dataA!.identityId).toBe(idA);

    // B has B data
    const dataB = await storageB.load();
    expect(dataB).not.toBeNull();
    expect(dataB!.identityId).toBe(idB);

    // Back to A — still has A data
    const dataA2 = await storageA.load();
    expect(dataA2).not.toBeNull();
    expect(dataA2!.identityId).toBe(idA);

    await storageA.close();
    await storageB.close();
  });

  it('persistCacheKey → new storage → loadPersistedKey → warm return', async () => {
    const id = makeId();
    const material = makeMaterial(9);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    // First storage: open, set key, persist, save data, close
    await storage.open(id);
    storage.setCacheKey(key);
    await storage.persistCacheKey();
    await storage.save(makeData(id));
    await storage.close();

    // New storage instance: open, load persisted key, load data
    const storage2 = new IdentityContextIDBStorage();
    await storage2.open(id);
    const loadedKey = await storage2.loadPersistedKey();
    expect(loadedKey).not.toBeNull();
    storage2.setCacheKey(loadedKey!);
    const loaded = await storage2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.identityId).toBe(id);
    await storage2.close();
  });

  it('openAndLoad without key → null', async () => {
    const id = makeId();
    const storage2 = new IdentityContextIDBStorage();
    const result = await storage2.openAndLoad(id);
    expect(result).toBeNull();
    await storage2.close();
  });

  it('openAndLoad with persisted key → returns data', async () => {
    const id = makeId();
    const material = makeMaterial(10);
    const salt = new Uint8Array(32);
    const key = await deriveCacheKey(material, salt);

    // First storage: persist key and save data
    await storage.open(id);
    storage.setCacheKey(key);
    await storage.persistCacheKey();
    await storage.save(makeData(id));
    await storage.close();

    // New storage: openAndLoad should load data using persisted key
    const storage2 = new IdentityContextIDBStorage();
    const result = await storage2.openAndLoad(id);
    expect(result).not.toBeNull();
    expect(result!.identityId).toBe(id);
    await storage2.close();
  });
});
