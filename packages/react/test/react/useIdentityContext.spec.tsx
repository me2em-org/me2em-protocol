// packages/react/test/react/useIdentityContext.spec.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useIdentityContext } from '../../src/react/useIdentityContext.js';
import { IdentityContextIDBStorage } from '../../src/headless/identity-context-storage.js';
import { deriveCacheKey } from '../../src/headless/context-crypto.js';
import { get32ByteSeedFromMnemonic, Identity } from '@me2em/core';
import type { IdentityContextData } from '../../src/headless/identity-context-types.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function publicKeyToId(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function setupIdentity(
  storage: IdentityContextIDBStorage,
  mnemonic: string
): Promise<string> {
  const seed = await get32ByteSeedFromMnemonic(mnemonic);
  const salt = new Uint8Array(32);
  const key = await deriveCacheKey(seed, salt);
  const identity = await Identity.fromSeed(seed);
  const identityId = publicKeyToId(identity.getPublicKey());
  await storage.open(identityId);
  storage.setCacheKey(key);
  return identityId;
}

describe('useIdentityContext', () => {
  let storage: IdentityContextIDBStorage;

  beforeEach(async () => {
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
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
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
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
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
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
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
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
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
