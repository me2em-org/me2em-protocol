import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { Identity } from '@me2em/core';
import { Me2emContext, type Me2emContextValue } from './context.js';

export function Me2emProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  // BL-47 dispose parity: the ref is mutated only in event handlers and
  // cleanup effects, always alongside setIdentity — never inside a state
  // updater (StrictMode double-invokes updaters; dispose is a side
  // effect). A replaced/cleared handle is disposed at the swap, so
  // stale references fail loudly with DisposedError (core contract)
  // instead of silently operating on zeroed key material.
  const identityRef = useRef<Identity | null>(null);
  // Generation ticket for in-flight Identity.fromSeed results — the
  // same load-race class fixed for useIdentityContext in rc.1: a
  // result landing after a newer activation, clearIdentity() or
  // unmount disposes its own handle instead of overwriting newer
  // state.
  const genRef = useRef(0);

  const activateIdentity = useCallback(async (seed: Uint8Array): Promise<boolean> => {
    const gen = ++genRef.current;
    try {
      const id = await Identity.fromSeed(seed);
      if (gen !== genRef.current) {
        // Superseded while in flight: discard this handle loudly
        // rather than leaking it into state.
        id.dispose();
        return false;
      }
      identityRef.current?.dispose(); // zero the replaced handle
      identityRef.current = id;
      setIdentity(id);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearIdentity = useCallback(() => {
    ++genRef.current; // invalidate in-flight activations
    identityRef.current?.dispose();
    identityRef.current = null;
    setIdentity(null);
  }, []);

  // Unmount: cleanup-only dispose — no side effects in render or
  // updaters (the identity was provider state, so it is unreachable
  // after unmount either way; dispose just zeroizes it eagerly).
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reading the LIVE ticket at teardown is the point: invalidate whatever activation is in flight at unmount; snapshotting it would defeat the guard
      ++genRef.current;
      identityRef.current?.dispose();
      identityRef.current = null;
    };
  }, []);

  const value = useMemo<Me2emContextValue>(
    () => ({ identity, hasIdentity: identity !== null, activateIdentity, clearIdentity }),
    [identity, activateIdentity, clearIdentity]
  );

  return <Me2emContext.Provider value={value}>{children}</Me2emContext.Provider>;
}
