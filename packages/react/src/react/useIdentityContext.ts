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
  /** Перезагрузить кэш для текущей identity (после sync). */
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
      storage.close();
    }

    prevIdentityIdRef.current = identityId;

    // Open storage for this identity and load cached context
    storage.open(identityId)
      .then(() => storage.load())
      .then((data) => {
        if (cancelled) return;
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
    await storage.save(data);
    setContext(data);
  }, [storage]);

  const clear = useCallback(async (): Promise<void> => {
    await storage.clear();
    setContext(null);
  }, [storage]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!identity) return;
    const identityId = publicKeyToId(identity.getPublicKey());
    await storage.open(identityId);
    const data = await storage.load();
    setContext(data);
  }, [identity, storage]);

  return { context, isLoaded, error, save, clear, refresh };
}
