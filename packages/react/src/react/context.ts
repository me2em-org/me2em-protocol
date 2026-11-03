import { createContext, useContext } from 'react';
import type { Identity } from '@me2em/core';

export interface Me2emContextValue {
  /**
   * Active identity, or null. The previously active identity is
   * disposed (key material zeroed) the moment it is replaced by a new
   * activation or by {@link clearIdentity} — stale references fail
   * loudly with `DisposedError` per the core contract (BL-47).
   */
  identity: Identity | null;
  hasIdentity: boolean;
  /**
   * Activates an identity from raw seed bytes, replacing (and
   * disposing) any previously active identity. Resolves `false` if
   * derivation failed or the activation was superseded by a newer
   * activation / `clearIdentity()` while in flight.
   *
   * Does not consume the seed — the caller owns the buffer and must
   * zero it when done (BL-48).
   */
  activateIdentity: (seed: Uint8Array) => Promise<boolean>;
  /** Disposes the active identity (if any) and clears it. */
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
