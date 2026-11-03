import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Me2emProvider } from '../../src/react/Me2emProvider.js';
import { useMe2emContext } from '../../src/react/context.js';
import { useHandle } from '../../src/react/useHandle.js';
import { useCreateIdentity } from '../../src/react/useCreateIdentity.js';
import { useImportSeed } from '../../src/react/useImportSeed.js';
import { get64ByteSeedFromMnemonic, Identity, DisposedError } from '@me2em/core';
describe('Me2emProvider', () => {
  it('returns hasIdentity=false when no identity', () => {
    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.hasIdentity).toBe(false);
    expect(result.current.identity).toBeNull();
  });

  it('activateIdentity sets hasIdentity=true after async completion', async () => {
    const seed = await get64ByteSeedFromMnemonic(
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
    const seed = await get64ByteSeedFromMnemonic(
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

const MNEMONIC_2 =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('Me2emProvider — BL-47 dispose parity', () => {
  it('re-activation disposes the replaced identity', async () => {
    const seed1 = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );
    const seed2 = await get64ByteSeedFromMnemonic(MNEMONIC_2);

    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await result.current.activateIdentity(seed1);
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(true);
    });
    const first = result.current.identity!;

    await result.current.activateIdentity(seed2);
    await waitFor(() => {
      expect(result.current.identity).not.toBe(first);
    });
    // The replaced handle is zeroed: capability methods reject loudly
    // with DisposedError (core contract) instead of silently working.
    await expect(first.deriveHandle('probe')).rejects.toThrow(DisposedError);
    // The replacement itself keeps working.
    await expect(
      result.current.identity!.deriveHandle('probe')
    ).resolves.not.toBeNull();
  });

  it('clearIdentity disposes the identity', async () => {
    const seed = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

    const { result } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await result.current.activateIdentity(seed);
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(true);
    });
    const id = result.current.identity!;

    result.current.clearIdentity();
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(false);
    });
    await expect(id.deriveHandle('probe')).rejects.toThrow(DisposedError);
  });

  it('unmount disposes the active identity', async () => {
    const seed = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

    const { result, unmount } = renderHook(() => useMe2emContext(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    await result.current.activateIdentity(seed);
    await waitFor(() => {
      expect(result.current.hasIdentity).toBe(true);
    });
    const id = result.current.identity!;

    unmount();
    await expect(id.deriveHandle('probe')).rejects.toThrow(DisposedError);
  });

  it('superseded in-flight activation resolves false and disposes its own handle', async () => {
    const seed1 = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );
    const seed2 = await get64ByteSeedFromMnemonic(MNEMONIC_2);
    const lateIdentity = await Identity.fromSeed(seed1); // loser, lands late

    let resolveSlow!: (id: Identity) => void;
    const slow = new Promise<Identity>((res) => {
      resolveSlow = res;
    });
    const realFromSeed = Identity.fromSeed.bind(Identity);
    let calls = 0;
    const spy = vi
      .spyOn(Identity, 'fromSeed')
      .mockImplementation(async (s: Uint8Array) => {
        calls += 1;
        if (calls === 1) return slow;
        return realFromSeed(s);
      });

    try {
      const { result } = renderHook(() => useMe2emContext(), {
        wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
      });

      const slowActivation = result.current.activateIdentity(seed1);
      await result.current.activateIdentity(seed2);
      await waitFor(() => {
        expect(result.current.hasIdentity).toBe(true);
      });
      const winner = result.current.identity!;

      resolveSlow(lateIdentity); // the slow result lands after the fast one
      await expect(slowActivation).resolves.toBe(false);

      // Newer state survived; the late loser was disposed by the
      // provider, not leaked into state.
      expect(result.current.identity).toBe(winner);
      await expect(
        lateIdentity.deriveHandle('probe')
      ).rejects.toThrow(DisposedError);
      await expect(
        winner.deriveHandle('probe')
      ).resolves.not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('failed derivation resolves false and leaves no identity', async () => {
    const seed = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );
    const spy = vi
      .spyOn(Identity, 'fromSeed')
      .mockRejectedValueOnce(new Error('derive failed'));

    try {
      const { result } = renderHook(() => useMe2emContext(), {
        wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
      });

      await expect(result.current.activateIdentity(seed)).resolves.toBe(false);
      expect(result.current.hasIdentity).toBe(false);
      expect(result.current.identity).toBeNull();
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

  it('discardSeed after confirm keeps status verified (BL-48)', async () => {
    function useCreateAndActivate() {
      const ctx = useMe2emContext();
      const ci = useCreateIdentity();
      return { ctx, ci };
    }

    const { result } = renderHook(() => useCreateAndActivate(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    result.current.ci.generate();
    await waitFor(() => {
      expect(result.current.ci.status).toBe('seed-generated');
    });

    result.current.ci.confirmWords();
    await waitFor(() => {
      expect(result.current.ci.status).toBe('verified');
    });

    result.current.ci.discardSeed();

    // The flow state stops holding the seed material (pinned at the
    // reducer level in identity-flow.spec.ts); the react surface keeps
    // a verified, error-free flow.
    expect(result.current.ci.status).toBe('verified');
    expect(result.current.ci.error).toBeNull();
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
    expect(result.current.error!.code).toBe('INVALID_WORDS');
    expect(result.current.identity).toBeNull();
  });

  it('importWords happy path: IMPORT → activated identity → discardSeed → reset', async () => {
    function useImportAndCheck() {
      const ctx = useMe2emContext();
      const imp = useImportSeed();
      return { ctx, imp };
    }

    const { result } = renderHook(() => useImportAndCheck(), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.imp.status).toBe('idle');

    await result.current.imp.importWords([
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ]);

    await waitFor(() => {
      expect(result.current.imp.status).toBe('imported');
    });
    await waitFor(() => {
      expect(result.current.ctx.identity).not.toBeNull();
    });
    // v1.1 (BL-50): activation success leaves the flow error-free —
    // the previously-ignored `activateIdentity` result is checked.
    expect(result.current.imp.error).toBeNull();

    // BL-48: drop the retained material once imported.
    result.current.imp.discardSeed();
    expect(result.current.imp.status).toBe('imported');
    expect(result.current.imp.error).toBeNull();

    result.current.imp.reset();
    await waitFor(() => {
      expect(result.current.imp.status).toBe('idle');
    });
    expect(result.current.ctx.identity).toBeNull();
  });

  it('importWords: activation failure → ACTIVATION_FAILED (v1.1, no longer swallowed)', async () => {
    const spy = vi
      .spyOn(Identity, 'fromSeed')
      .mockRejectedValueOnce(new Error('derive failed'));

    try {
      function useImportAndCheck() {
        const ctx = useMe2emContext();
        const imp = useImportSeed();
        return { ctx, imp };
      }

      const { result } = renderHook(() => useImportAndCheck(), {
        wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
      });

      await result.current.imp.importWords([
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
      ]);

      await waitFor(() => {
        expect(result.current.imp.status).toBe('error');
      });
      // rc.1–rc.3 silently ignored the `activateIdentity` result here —
      // the flow stayed 'imported' with no error while the identity was
      // never activated. v1.1 surfaces it as a structured failure.
      expect(result.current.imp.error).toEqual({
        code: 'ACTIVATION_FAILED',
        message: 'Identity activation failed',
      });
      expect(result.current.ctx.identity).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useHandle', () => {
  it('returns structured NO_IDENTITY without identity (BL-50)', () => {
    const { result } = renderHook(() => useHandle('test-handle'), {
      wrapper: ({ children }) => <Me2emProvider>{children}</Me2emProvider>,
    });

    expect(result.current.handle).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.code).toBe('NO_IDENTITY');
  });

  it('returns { handle, error: null } after identity activation', async () => {
    const seed = await get64ByteSeedFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

    function useHandleAndActivate() {
      const ctx = useMe2emContext();
      const { handle, error } = useHandle('test-handle');
      return { ctx, handle, error };
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
    expect(result.current.error).toBeNull();
  });
});
