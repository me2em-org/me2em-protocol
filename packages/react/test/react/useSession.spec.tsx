// packages/react/test/react/useSession.spec.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useSession } from '../../src/react/useSession.js';
import { useHandle } from '../../src/react/useHandle.js';
import { get64ByteSeedFromMnemonic } from '@me2em/core';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

afterEach(() => {
  // drop any per-test visibilityState override (jsdom default: visible)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (document as any).visibilityState;
  vi.useRealTimers();
});

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
      const { handle } = useHandle('test-handle');
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
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
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
      const { handle } = useHandle('renew-handle');
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
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
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
      const { handle } = useHandle('autorenew-handle');
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
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    const firstJti = result.current.session!.sessionId;

    // Wait for auto-renewal (half of 2s TTL = ~1s). BL-53: waitFor
    // polls, so the test ends as soon as the renewal lands instead of
    // sleeping a fixed 3 s.
    await waitFor(
      () => {
        expect(result.current.session!.sessionId).not.toBe(firstJti);
      },
      { timeout: 5000 }
    );
  });

  it('autoRenew:false + ttl:1 → isExpired', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle } = useHandle('expiry-handle');
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
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
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

    // Wait for TTL to expire (1 second). BL-53: bounded waitFor
    // replaces a fixed 2 s sleep.
    await waitFor(
      () => {
        expect(result.current.session!.isExpired()).toBe(true);
      },
      { timeout: 5000 }
    );
  });

  it('renews on return to visibility when past half-life (BL-51)', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle } = useHandle('visibility-handle');
      const { session } = useSession(handle, {
        audience: 'vis.test',
        scopes: ['read'],
        ttl: 3600,
      });
      return { ctx, handle, session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    const firstJti = result.current.session!.sessionId;

    // The half-life timer (30 min) must not fire during this test —
    // fake only Date so the half-life gate evaluates against a
    // controlled clock while the real timer stays pending.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 1_801_000); // just past ttl/2

      // Hidden → the handler must ignore the event.
      setVisibility('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // Absence window (BL-53): a real-timer pause — waitFor cannot
      // prove a renewal did NOT happen; a buggy renew would flip the
      // jti assert below within this window.
      await new Promise((r) => setTimeout(r, 25));
      expect(result.current.session!.sessionId).toBe(firstJti);

      // Visible again → proactive renewal, no overdue-timer wait.
      setVisibility('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(result.current.session!.sessionId).not.toBe(firstJti);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('no renewal on visibility before half-life (BL-51)', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle } = useHandle('vis-early-handle');
      const { session } = useSession(handle, {
        audience: 'vis-early.test',
        scopes: ['read'],
        ttl: 3600,
      });
      return { ctx, handle, session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    const firstJti = result.current.session!.sessionId;

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 60_000); // 1 min — before ttl/2
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // Absence window (BL-53): a real-timer pause — waitFor cannot
      // prove a renewal did NOT happen; a buggy renew would flip the
      // jti assert below within this window.
      await new Promise((r) => setTimeout(r, 25));
      expect(result.current.session!.sessionId).toBe(firstJti);
    } finally {
      vi.useRealTimers();
    }
  });

  it('autoRenew:false opts out of visibility renewal (BL-51)', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle } = useHandle('vis-optout-handle');
      const { session } = useSession(handle, {
        audience: 'vis-optout.test',
        scopes: ['read'],
        ttl: 3600,
      }, false);
      return { ctx, handle, session };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await act(async () => {
      const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
      await result.current.ctx.activateIdentity(seed);
    });

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });

    const firstJti = result.current.session!.sessionId;

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 3_500_000); // far past half-life
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // Absence window (BL-53): a real-timer pause — waitFor cannot
      // prove a renewal did NOT happen; a buggy renew would flip the
      // jti assert below within this window.
      await new Promise((r) => setTimeout(r, 25));
      expect(result.current.session!.sessionId).toBe(firstJti);
    } finally {
      vi.useRealTimers();
    }
  });
});
