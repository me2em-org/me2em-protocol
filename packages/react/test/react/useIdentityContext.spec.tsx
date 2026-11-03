// packages/react/test/react/useIdentityContext.spec.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useIdentityContext } from '../../src/react/useIdentityContext.js';
import { IdentityContextIDBStorage } from '../../src/headless/identity-context-storage.js';
import { deriveCacheKey } from '../../src/headless/context-crypto.js';
import type { IdentityContextData, IdentityContextStorage } from '../../src/headless/identity-context-types.js';
import { IDBFactory } from 'fake-indexeddb';
import { get64ByteSeedFromMnemonic, Identity } from '@me2em/core';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Second standard BIP39 test vector — a different identity for
// identity-switch tests.
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

function publicKeyToId(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function setupIdentity(
  storage: IdentityContextIDBStorage,
  mnemonic: string
): Promise<string> {
  const seed = await get64ByteSeedFromMnemonic(mnemonic);
  const salt = new Uint8Array(32);
  const key = await deriveCacheKey(seed, salt);
  const identity = await Identity.fromSeed(seed);
  const identityId = publicKeyToId(identity.getPublicKey());
  await storage.open(identityId);
  storage.setCacheKey(key);
  return identityId;
}

// In-memory storage whose first openAndLoad rejects — drives the
// error state so the tests can pin that a successful save()/clear()
// resets it.
class FailOnceLoadStorage implements IdentityContextStorage {
  private failed = false;
  private saved: IdentityContextData | null = null;

  async openAndLoad(): Promise<IdentityContextData | null> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('load boom');
    }
    return this.saved;
  }

  async save(data: IdentityContextData): Promise<void> {
    this.saved = data;
  }

  async load(): Promise<IdentityContextData | null> {
    return this.saved;
  }

  async clear(): Promise<void> {
    this.saved = null;
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}
  setCacheKey(): void {}
  getCacheKey(): CryptoKey | null {
    return null;
  }
  async persistCacheKey(): Promise<void> {}
  async loadPersistedKey(): Promise<CryptoKey | null> {
    return null;
  }
}

describe('useIdentityContext', () => {
  let storage: IdentityContextIDBStorage;

  beforeEach(async () => {
    // Fresh fake-IndexedDB per test: the tests derive the same identity
    // from the same mnemonic, so the DB name is identical across tests —
    // a shared database leaks the previous test's record into the next
    // one (the stale 'test-handle' seen in a CI flake of the rerender
    // test below).
    globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory;
    storage = new IdentityContextIDBStorage();
  });

  afterEach(async () => {
    try {
      await storage.close();
    } catch { /* already closed */ }
  });

  it('without identity → context null', async () => {
    const { result } = renderHook(() => useIdentityContext(storage), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });
    expect(result.current.context).toBeNull();
  });

  it('activate + save(data) → context === data', async () => {
    const identityId = await setupIdentity(storage, MNEMONIC);

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(storage);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const testData: IdentityContextData = {
      identityId,
      handles: [{ name: 'test-handle' }],
      savedAt: Date.now(),
    };

    await act(async () => {
      await result.current.ic.save(testData);
    });

    expect(result.current.ic.context).not.toBeNull();
    expect(result.current.ic.context!.identityId).toBe(identityId);
  });

  it('rerender → context stays', async () => {
    const identityId = await setupIdentity(storage, MNEMONIC);

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(storage);
      return { ctx, ic };
    }

    const { result, rerender } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const testData: IdentityContextData = {
      identityId,
      handles: [{ name: 'persistent-handle' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(testData);
    });

    expect(result.current.ic.context!.handles[0].name).toBe('persistent-handle');

    // Rerender
    rerender();

    await waitFor(() => {
      expect(result.current.ic.context).not.toBeNull();
    });
    expect(result.current.ic.context!.handles[0].name).toBe('persistent-handle');
  });

  it('in-flight load resolving after save does not clobber saved state', async () => {
    const identityId = await setupIdentity(storage, MNEMONIC);

    // Storage proxy that captures the load snapshot BEFORE the test's
    // save() runs and holds it until released — a deterministic
    // reproduction of the CI flake: the identity-change load resolves
    // late with pre-save data and must be dropped, not committed over
    // the saved state (out-of-order async update).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gated = new Proxy(storage, {
      get(target, prop, receiver) {
        if (prop === 'openAndLoad') {
          return async (id: string) => {
            const pending = target.openAndLoad(id); // real read: pre-save snapshot
            await gate;
            return pending;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as IdentityContextStorage;

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(gated);
      return { ctx, ic };
    }

    const { result, rerender } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const testData: IdentityContextData = {
      identityId,
      handles: [{ name: 'persistent-handle' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(testData);
    });
    expect(result.current.ic.context!.handles[0].name).toBe('persistent-handle');

    // Release the held pre-save snapshot: without generation
    // sequencing the hook would now commit it (null on a fresh DB)
    // over the saved state.
    await act(async () => {
      release();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.ic.context!.handles[0].name).toBe('persistent-handle');
  });

  it('save resolving after an identity switch does not surface the previous identity context', async () => {
    await setupIdentity(storage, MNEMONIC);

    // Gate save() so its commit lands strictly after the identity is
    // gone: the generation ticket only orders save against in-flight
    // loads, so without the identity guard the late commit would write
    // identity A's context over the cleared state.
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const gated = new Proxy(storage, {
      get(target, prop, receiver) {
        if (prop === 'save') {
          return async (data: IdentityContextData) => {
            const pending = target.save(data);
            await gate;
            await pending;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as IdentityContextStorage;

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(gated);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });
    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const dataA: IdentityContextData = {
      identityId: publicKeyToId(result.current.ctx.identity!.getPublicKey()),
      handles: [{ name: 'identity-a-handle' }],
      savedAt: Date.now(),
    };

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = result.current.ic.save(dataA);
    });

    await act(async () => {
      result.current.ctx.clearIdentity();
    });
    await waitFor(() => {
      expect(result.current.ic.context).toBeNull();
    });

    await act(async () => {
      releaseSave();
      await savePromise;
    });
    expect(result.current.ic.context).toBeNull();
  });

  it('clear resolving after an identity switch does not blank the new identity loaded context', async () => {
    // Pre-seed identity B's database so the switch has a real cached
    // context to load (persisted key included, since openAndLoad on the
    // reopened storage reads it back from KEYS_STORE).
    const seedB = await get64ByteSeedFromMnemonic(MNEMONIC_B);
    const identityB = await Identity.fromSeed(seedB);
    const identityIdB = publicKeyToId(identityB.getPublicKey());
    await storage.open(identityIdB);
    storage.setCacheKey(await deriveCacheKey(seedB, new Uint8Array(32)));
    const dataB: IdentityContextData = {
      identityId: identityIdB,
      handles: [{ name: 'identity-b-handle' }],
      savedAt: Date.now(),
    };
    await storage.save(dataB);
    await storage.persistCacheKey();
    await storage.close();

    const identityIdA = await setupIdentity(storage, MNEMONIC);

    // Gate clear() so it resolves strictly after identity B is active
    // and has its context loaded.
    let releaseClear!: () => void;
    const gate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const gated = new Proxy(storage, {
      get(target, prop, receiver) {
        if (prop === 'clear') {
          return async () => {
            const pending = target.clear();
            await gate;
            await pending;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as IdentityContextStorage;

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(gated);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });
    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const dataA: IdentityContextData = {
      identityId: identityIdA,
      handles: [{ name: 'identity-a-handle' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(dataA);
    });

    let clearPromise!: Promise<void>;
    await act(async () => {
      clearPromise = result.current.ic.clear();
    });

    await act(async () => {
      await result.current.ctx.activateIdentity(seedB);
    });
    await waitFor(() => {
      expect(result.current.ic.context?.handles[0].name).toBe('identity-b-handle');
    });

    await act(async () => {
      releaseClear();
      await clearPromise;
    });
    expect(result.current.ic.context!.handles[0].name).toBe('identity-b-handle');
  });

  it('save resets a previous load error', async () => {
    // One stable instance: an inline `new` in the wrapper would change
    // the effect's [identity, storage] deps every render and re-run the
    // load (and its rejection) after save() has already reset the error.
    const stub = new FailOnceLoadStorage();
    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(stub);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });
    await waitFor(() => {
      expect(result.current.ic.error).toBe('load boom');
    });

    const testData: IdentityContextData = {
      identityId: 'any',
      handles: [{ name: 'after-error' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(testData);
    });
    expect(result.current.ic.error).toBeNull();
    expect(result.current.ic.context!.handles[0].name).toBe('after-error');
  });

  it('clear resets a previous load error', async () => {
    const stub = new FailOnceLoadStorage();
    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(stub);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });
    await waitFor(() => {
      expect(result.current.ic.error).toBe('load boom');
    });

    await act(async () => {
      await result.current.ic.clear();
    });
    expect(result.current.ic.error).toBeNull();
    expect(result.current.ic.context).toBeNull();
  });

  it('clear → null', async () => {
    const identityId = await setupIdentity(storage, MNEMONIC);

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(storage);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const testData: IdentityContextData = {
      identityId,
      handles: [{ name: 'to-clear' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(testData);
    });
    expect(result.current.ic.context).not.toBeNull();

    await act(async () => {
      await result.current.ic.clear();
    });
    expect(result.current.ic.context).toBeNull();
  });

  it('(isolation) new identity → context null, first data inaccessible', async () => {
    const identityIdA = await setupIdentity(storage, MNEMONIC);

    function HookWrapper() {
      const ctx = useMe2emContext();
      const ic = useIdentityContext(storage);
      return { ctx, ic };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });

    const dataA: IdentityContextData = {
      identityId: identityIdA,
      handles: [{ name: 'identity-a-handle' }],
      savedAt: Date.now(),
    };
    await act(async () => {
      await result.current.ic.save(dataA);
    });

    await waitFor(() => {
      expect(result.current.ic.context).not.toBeNull();
    });
    expect(result.current.ic.context!.handles[0].name).toBe('identity-a-handle');

    // Clear and activate different identity
    await act(async () => {
      result.current.ctx.clearIdentity();
    });

    // Context should be null for cleared identity
    await waitFor(() => {
      expect(result.current.ic.context).toBeNull();
    });
  });
});
