// packages/react/test/react/useSession.spec.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useSession } from '../../src/react/useSession.js';
import { useHandle } from '../../src/react/useHandle.js';
import { get32ByteSeedFromMnemonic } from '@me2em/core';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('useSession', () => {
  it('without handle → null', async () => {
    function HookWrapper() {
      const { session } = useSession(null, {
        audience: 'test.audience',
        scopes: ['read'],
        ttl: 3600,
      });
      return { session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await waitFor(() => {
      expect(result.current.session).toBeNull();
    });
  });

  it('with handle → session', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const handle = useHandle('test-handle');
      const { session } = useSession(handle, {
        audience: 'test.audience',
        scopes: ['read', 'write'],
        ttl: 3600,
      });
      return { ctx, handle, session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    expect(result.current.session!.audience).toBe('test.audience');
  });

  it('renew → jti changed', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const handle = useHandle('renew-handle');
      const { session, isLoaded, renew } = useSession(handle, {
        audience: 'renew.test',
        scopes: ['write'],
        ttl: 3600,
      });
      return { ctx, handle, session, isLoaded, renew };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    const firstJti = result.current.session!.sessionId;

    await act(async () => {
      result.current.renew();
    });

    await waitFor(() => {
      expect(result.current.session!.sessionId).not.toBe(firstJti);
    });
  });

  it('auto-renew ttl:2 → jti changed', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const handle = useHandle('autorenew-handle');
      const { session } = useSession(handle, {
        audience: 'auto.test',
        scopes: ['read'],
        ttl: 2,
      });
      return { ctx, handle, session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    const firstJti = result.current.session!.sessionId;

    // Wait for auto-renewal (half of 2s TTL = ~1s, plus buffer)
    await new Promise((r) => setTimeout(r, 3000));

    await waitFor(() => {
      expect(result.current.session!.sessionId).not.toBe(firstJti);
    });
  });

  it('autoRenew:false + ttl:1 → isExpired', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const handle = useHandle('expiry-handle');
      const { session, isLoaded } = useSession(handle, {
        audience: 'expiry.test',
        scopes: ['read'],
        ttl: 1,
      }, false);
      return { ctx, handle, session, isLoaded };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get32ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    }, { timeout: 5000 });

    // Initially not expired
    expect(result.current.session!.isExpired()).toBe(false);

    // Wait for TTL to expire (1 second)
    await new Promise((r) => setTimeout(r, 2000));

    expect(result.current.session!.isExpired()).toBe(true);
  });
});
