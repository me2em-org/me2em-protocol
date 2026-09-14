import { createContext, useContext } from 'react';
import type { Identity } from '@me2em/core';

export interface Me2emContextValue {
  identity: Identity | null;
  hasIdentity: boolean;
  activateIdentity: (seed: Uint8Array) => void;
  clearIdentity: () => void;
}

export const Me2emContext = createContext<Me2emContextValue | null>(null);

export function useMe2emContext(): Me2emContextValue {
  const ctx = useContext(Me2emContext);
  if (!ctx) {
    throw new Error('Me2em hooks must be used inside <Me2emProvider>');
  }
  return ctx;
}
