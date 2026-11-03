import { useState, useEffect } from 'react';
import { type SubHandle } from '@me2em/core';
import { useMe2emContext } from './context.js';

/**
 * Derives the named SubHandle under the given Handle.
 *
 * Silent-failure contract (R7): on derivation failure the hook logs
 * via console.error and keeps returning null — there is no thrown or
 * returned error signal. The structured `{ handle, error }` shape is
 * a post-freeze v1.1 candidate (BL-50).
 */
export function useSubHandle(
  handleName: string,
  subName: string
): SubHandle | null {
  const { identity } = useMe2emContext();
  const [subHandle, setSubHandle] = useState<SubHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the stale async result when identity is gone; set-during-render refactor is a tracked post-rc.2 follow-up
      setSubHandle(null);
      return;
    }
    identity
      .deriveSubHandle(handleName, subName)
      .then((h) => {
        if (!cancelled) setSubHandle(h);
      })
      .catch((err) => {
        if (!cancelled) console.error('useSubHandle derivation failed', err);
      });
    return () => { cancelled = true; };
  }, [identity, handleName, subName]);

  return subHandle;
}
