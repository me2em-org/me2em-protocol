// packages/react/src/react/useHandle.ts
import { useState, useEffect } from 'react';
import { type Handle } from '@me2em/core';
import { useMe2emContext } from './context.js';

export function useHandle(name: string): Handle | null {
  const { identity } = useMe2emContext();
  const [handle, setHandle] = useState<Handle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the stale async result when identity is gone; set-during-render refactor is a tracked post-rc.2 follow-up
      setHandle(null);
      return;
    }
    // Core performs full name canonicalization (NFKC, lowercase,
    // trim) and validation — no local normalization here.
    identity.deriveHandle(name).then((h) => {
      if (!cancelled) setHandle(h);
    }).catch((err) => {
      if (!cancelled) console.error('useHandle derivation failed', err);
    });
    return () => { cancelled = true; };
  }, [identity, name]);

  return handle;
}
