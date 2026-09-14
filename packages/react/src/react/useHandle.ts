import { useState, useEffect, useMemo } from 'react';
import { type Handle } from '@me2em/core';
import { useMe2emContext } from './context.js';

export function useHandle(name: string): Handle | null {
  const { identity } = useMe2emContext();
  const [handle, setHandle] = useState<Handle | null>(null);

  const normalizedName = useMemo(() => {
    return name.toLowerCase().trim();
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      setHandle(null);
      return;
    }
    identity.deriveHandle(normalizedName).then((h) => {
      if (!cancelled) setHandle(h);
    }).catch((err) => {
      if (!cancelled) console.error('useHandle derivation failed', err);
    });
    return () => { cancelled = true; };
  }, [identity, normalizedName]);

  return handle;
}
