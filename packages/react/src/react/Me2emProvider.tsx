import {
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Identity } from '@me2em/core';
import { Me2emContext, type Me2emContextValue } from './context.js';

export function Me2emProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const pendingSeed = useRef<Uint8Array | null>(null);

  const activateIdentity = useCallback(async (seed: Uint8Array) => {
    pendingSeed.current = seed;
    try {
      const id = await Identity.fromSeed(seed);
      setIdentity(id);
    } catch {
      pendingSeed.current = null;
    }
  }, []);

  const clearIdentity = useCallback(() => {
    setIdentity(null);
    pendingSeed.current = null;
  }, []);

  const value = useMemo<Me2emContextValue>(
    () => ({ identity, hasIdentity: identity !== null, activateIdentity, clearIdentity }),
    [identity, activateIdentity, clearIdentity]
  );

  return <Me2emContext.Provider value={value}>{children}</Me2emContext.Provider>;
}
