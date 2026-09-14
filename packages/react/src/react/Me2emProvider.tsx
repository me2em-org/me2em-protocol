import {
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { Identity } from '@me2em/core';
import { Me2emContext, type Me2emContextValue } from './context.js';

export function Me2emProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);

  const activateIdentity = useCallback(async (seed: Uint8Array): Promise<boolean> => {
    try {
      const id = await Identity.fromSeed(seed);
      setIdentity(id);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearIdentity = useCallback(() => {
    setIdentity(null);
  }, []);

  const value = useMemo<Me2emContextValue>(
    () => ({ identity, hasIdentity: identity !== null, activateIdentity, clearIdentity }),
    [identity, activateIdentity, clearIdentity]
  );

  return <Me2emContext.Provider value={value}>{children}</Me2emContext.Provider>;
}
