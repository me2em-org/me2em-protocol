import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useHandle } from '../../src/react/useHandle.js';

describe('Me2emProvider', () => {
  it('returns hasIdentity=false when no identity', () => {
    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.hasIdentity).toBe(false);
    expect(result.current.identity).toBeNull();
  });

  it('activateIdentity sets hasIdentity=true after async completion', async () => {
    const seed = await (async () => {
      const { get32ByteSeedFromMnemonic } = await import('@me2em/core');
      return get32ByteSeedFromMnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      );
    })();

    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await result.current.activateIdentity(seed);
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(true);
    });
    expect(result.current.identity).not.toBeNull();
  });

  it('clearIdentity sets hasIdentity=false', async () => {
    const seed = await (async () => {
      const { get32ByteSeedFromMnemonic } = await import('@me2em/core');
      return get32ByteSeedFromMnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      );
    })();

    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await result.current.activateIdentity(seed);
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(true);
    });

    result.current.clearIdentity();
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(false);
    });
    expect(result.current.identity).toBeNull();
  });

  it('throws when used outside Provider', () => {
    expect(() => renderHook(() => useMe2emContext())).toThrow(
      'Me2em hooks must be used inside <Me2emProvider>'
    );
  });
});

describe('useHandle', () => {
  it('returns null without identity', () => {
    const { result } = renderHook(() => useHandle('test-handle'), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current).toBeNull();
  });

  it('returns Handle after identity activation', async () => {
    const seed = await (async () => {
      const { get32ByteSeedFromMnemonic } = await import('@me2em/core');
      return get32ByteSeedFromMnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      );
    })();

    function useHandleAndActivate() {
      const ctx = useMe2emContext();
      const handle = useHandle('test-handle');
      return { ctx, handle };
    }

    const { result } = renderHook(() => useHandleAndActivate(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.handle).toBeNull();

    await result.current.ctx.activateIdentity(seed);
    await waitFor(() => {
      expect(result.current.handle).not.toBeNull();
    });

    expect(result.current.handle).not.toBeNull();
    expect(result.current.handle!.getName()).toBe('test-handle');
  });
});
