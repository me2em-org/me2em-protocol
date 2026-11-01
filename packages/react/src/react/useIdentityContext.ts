// packages/react/src/react/useIdentityContext.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { IdentityContextStorage, IdentityContextData } from '../headless/identity-context-types.js';
import { useMe2emContext } from './context.js';

function publicKeyToId(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

  useEffect(() => {
    let cancelled = false;

    if (!identity) {
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
    opRef.current += 1; // invalidate any in-flight load/refresh
    await storage.save(data);
    setContext(data);
  }, [storage]);

  const clear = useCallback(async (): Promise<void> => {
    opRef.current += 1; // invalidate any in-flight load/refresh
    await storage.clear();
    setContext(null);
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
