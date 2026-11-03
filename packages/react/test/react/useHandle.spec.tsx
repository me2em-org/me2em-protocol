// packages/react/test/react/useHandle.spec.tsx
//
// BL-50 (v1.1): structured { handle | subHandle, error } results for the
// derivation hooks — success, pending, NO_IDENTITY, core AttestationError
// codes (real MALFORMED path, DISPOSED via dispose+rerender) and UNKNOWN
// for failures outside the core error model.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Identity, get64ByteSeedFromMnemonic } from '@me2em/core';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useHandle } from '../../src/react/useHandle.js';
import { useSubHandle } from '../../src/react/useSubHandle.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('useHandle (BL-50 structured result)', () => {
  it('NO_IDENTITY without an activated identity', () => {
    const { result } = renderHook(() => useHandle('lonely-handle'), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.handle).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.code).toBe('NO_IDENTITY');
  });

  it('success after activation: { handle, error: null }', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle, error } = useHandle('alice');
      return { ctx, handle, error };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await actActivate(result);

    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });
    expect(result.current.handle!.getName()).toBe('alice');
    expect(result.current.error).toBeNull();
  });

  it('MALFORMED for a non-canonicalizable name (real core path)', async () => {
    let name = 'valid-name';
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle, error } = useHandle(name);
      return { ctx, handle, error };
    }

    const { result, rerender } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await actActivate(result);
    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    name = '';
    rerender(HookWrapper);

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.handle).toBeNull();
    expect(result.current.error!.code).toBe('MALFORMED');
    expect(result.current.error!.message).toContain('Invalid name');
  });

  it('DISPOSED after the identity is disposed and the name changes', async () => {
    let name = 'before-dispose';
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { handle, error } = useHandle(name);
      return { ctx, handle, error };
    }

    const { result, rerender } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await actActivate(result);
    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    await actDispose(result);

    name = 'after-dispose';
    rerender(HookWrapper);

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.handle).toBeNull();
    expect(result.current.error!.code).toBe('DISPOSED');
  });

  it('UNKNOWN for a failure outside the core error model', async () => {
    const spy = vi
      .spyOn(Identity.prototype, 'deriveHandle')
      .mockRejectedValueOnce(new Error('boom'));
    try {
      function HookWrapper() {
        const ctx = useMe2emContext();
        const { handle, error } = useHandle('mocked-handle');
        return { ctx, handle, error };
      }

      const { result } = renderHook(HookWrapper, {
        wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
      });

      await actActivate(result);

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });
      expect(result.current.handle).toBeNull();
      expect(result.current.error!.code).toBe('UNKNOWN');
      expect(result.current.error!.message).toBe('boom');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useSubHandle (BL-50 structured result)', () => {
  it('NO_IDENTITY without an activated identity', () => {
    const { result } = renderHook(() => useSubHandle('h', 'sub'), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.subHandle).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.code).toBe('NO_IDENTITY');
  });

  it('success after activation: { subHandle, error: null }', async () => {
    function HookWrapper() {
      const ctx = useMe2emContext();
      const { subHandle, error } = useSubHandle('alice', 'connector-1');
      return { ctx, subHandle, error };
    }

    const { result } = renderHook(HookWrapper, {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await actActivate(result);

    await waitFor(() => {
      expect(result.current.subHandle).not.toBeNull();
    });
    expect(result.current.subHandle!.getName()).toBe('connector-1');
    expect(result.current.error).toBeNull();
  });
});

/** Activates a real identity through the provider context. */
type HookResult<T> = { current: T };

async function actActivate(
  result: HookResult<{ ctx: ReturnType<typeof useMe2emContext> }>
): Promise<void> {
  const { act } = await import('@testing-library/react');
  await act(async () => {
    const seed = await get64ByteSeedFromMnemonic(MNEMONIC);
    await result.current.ctx.activateIdentity(seed);
  });
}

async function actDispose(
  result: HookResult<{ ctx: ReturnType<typeof useMe2emContext> }>
): Promise<void> {
  const { act } = await import('@testing-library/react');
  await act(async () => {
    result.current.ctx.identity?.dispose();
  });
}
