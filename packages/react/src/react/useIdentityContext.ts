// packages/react/src/react/useIdentityContext.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Identity } from '@me2em/core';
import type { IdentityContextStorage, IdentityContextData } from '../headless/identity-context-types.js';
import { useMe2emContext } from './context.js';

function publicKeyToId(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function identityToId(identity: Identity | null): string | null {
  return identity ? publicKeyToId(identity.getPublicKey()) : null;
}

export interface UseIdentityContextResult {
  context: IdentityContextData | null;
  isLoaded: boolean;
  error: string | null;
  save: (data: IdentityContextData) => Promise<void>;
  clear: () => Promise<void>;
  /** Reload the cache for the current identity (after sync). */
  refresh: () => Promise<void>;
}

export function useIdentityContext(
  storage: IdentityContextStorage
): UseIdentityContextResult {
  const { identity } = useMe2emContext();
  const [context, setContext] = useState<IdentityContextData | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevIdentityIdRef = useRef<string | null>(null);
  // Generation ticket for async state transitions. Load (identity
  // change / `refresh()`), `save()` and `clear()` each take a ticket;
  // a resolution may only commit state while its ticket is the newest
  // one. Without this, an in-flight load started before a save could
  // resolve after it and clobber the just-saved state with pre-save
  // data (out-of-order async update — observed as a rare CI flake in
  // the rerender spec; pinned there by a gated-storage test).
  const opRef = useRef(0);
  const identityRef = useRef<Identity | null>(null);
  // eslint-disable-next-line react-hooks/refs -- render-time mirror of the latest identity: save()/clear() are stable callbacks (storage-only deps) and must verify at commit time, after their await, that the identity they started for is still the active one
  identityRef.current = identity;

  useEffect(() => {
    let cancelled = false;

    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the stale async state when identity is gone (generation-ticket effect from the load-race fix); set-during-render refactor is a tracked post-rc.2 follow-up
      setContext(null);
      setIsLoaded(true);
      setError(null);
      return;
    }

    const identityId = publicKeyToId(identity.getPublicKey());

    // If identity changed, close old storage and open new
    if (prevIdentityIdRef.current !== null && prevIdentityIdRef.current !== identityId) {
      storage.close().catch(() => { /* ignore close errors */ });
    }

    prevIdentityIdRef.current = identityId;

    // Open storage for this identity and load cached context (atomic)
    const op = ++opRef.current;
    storage.openAndLoad(identityId)
      .then((data) => {
        if (cancelled || op !== opRef.current) return;
        setContext(data);
        setIsLoaded(true);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, storage]);

  const save = useCallback(async (data: IdentityContextData): Promise<void> => {
    const idAtStart = identityToId(identityRef.current);
    opRef.current += 1; // invalidate any in-flight load/refresh
    await storage.save(data);
    // If the identity switched while the write was in flight, state
    // ownership has moved to the new identity's load effect — committing
    // here would surface identity A's context under identity B. The
    // generation ticket above only orders this op against in-flight
    // loads; it does not know about identity switches.
    if (identityToId(identityRef.current) !== idAtStart) return;
    setContext(data);
    setError(null);
  }, [storage]);

  const clear = useCallback(async (): Promise<void> => {
    const idAtStart = identityToId(identityRef.current);
    opRef.current += 1; // invalidate any in-flight load/refresh
    await storage.clear();
    // Same ownership rule as save(): a clear() resolving after an
    // identity switch must not blank the new identity's freshly
    // loaded context.
    if (identityToId(identityRef.current) !== idAtStart) return;
    setContext(null);
    setError(null);
  }, [storage]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!identity) return;
    const identityId = publicKeyToId(identity.getPublicKey());
    const op = ++opRef.current;
    const data = await storage.openAndLoad(identityId);
    if (op !== opRef.current) return;
    setContext(data);
  }, [identity, storage]);

  return { context, isLoaded, error, save, clear, refresh };
}
