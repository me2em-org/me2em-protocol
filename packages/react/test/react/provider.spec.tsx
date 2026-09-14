import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useHandle } from '../../src/react/useHandle.js';
import { useCreateIdentity } from '../../src/react/useCreateIdentity.js';
import { useImportSeed } from '../../src/react/useImportSeed.js';
import { get32ByteSeedFromMnemonic } from '@me2em/core';
describe('Me2emProvider', () => {
  it('returns hasIdentity=false when no identity', () => {
    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.hasIdentity).toBe(false);
    expect(result.current.identity).toBeNull();
  });

  it('activateIdentity sets hasIdentity=true after async completion', async () => {
    const seed = await get32ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

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
    const seed = await get32ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useMe2emContext())).toThrow(
        'Me2em hooks must be used inside <Me2emProvider>'
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useCreateIdentity', () => {
  it('generate → confirmWords → identity in context is not null', async () => {
    function useCreateAndActivate() {
      const ctx = useMe2emContext();
      const ci = useCreateIdentity();
      return { ctx, ci };
    }

    const { result } = renderHook(() => useCreateAndActivate(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.ci.status).toBe('idle');
    expect(result.current.ci.seedWords).toBeNull();

    result.current.ci.generate();
    await waitFor(() => {
      expect(result.current.ci.status).toBe('seed-generated');
    });
    expect(result.current.ci.seedWords).not.toBeNull();
    expect(result.current.ci.seedWords!.length).toBe(12);

    result.current.ci.confirmWords();
    await waitFor(() => {
      expect(result.current.ci.status).toBe('verified');
    });
    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });
  });

  it('confirmWords from idle does not change state', () => {
    const { result } = renderHook(() => useCreateIdentity(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.status).toBe('idle');

    result.current.confirmWords();
    expect(result.current.status).toBe('idle');
  });

  it('importWords with invalid phrase → error, identity null', async () => {
    const { result } = renderHook(() => useImportSeed(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.identity).toBeNull();

    await result.current.importWords(['not', 'a', 'valid', 'phrase']);

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.identity).toBeNull();
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
    const seed = await get32ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

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

    expect(result.current.handle!.getName()).toBe('test-handle');
  });
});
