import { useState, useEffect } from 'react';
import { type SubHandle } from '@me2em/core';
import { useMe2emContext } from './context.js';

export function useSubHandle(
  handleName: string,
  subName: string
): SubHandle | null {
  const { identity } = useMe2emContext();
  const [subHandle, setSubHandle] = useState<SubHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
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
