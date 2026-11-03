import { useState, useEffect } from 'react';
import { useMe2emContext } from './context.js';
import {
  toHookError,
  type Me2emHookError,
  type SubHandleResult,
} from './hook-results.js';

const NO_IDENTITY_ERROR: Me2emHookError = {
  code: 'NO_IDENTITY',
  message: 'No activated identity in Me2emProvider',
};

/**
 * Derives the named SubHandle under the given Handle.
 *
 * Structured result (BL-50, v1.1 — early break accepted 2026-11-04):
 * the hook returns `{ subHandle, error: null }` on success,
 * `{ subHandle: null, error }` on failure — `error.code` is
 * machine-readable (`AttestationErrorCode` from core, plus
 * `NO_IDENTITY` when the provider has no activated identity and
 * `UNKNOWN` for failures outside the core error model) — and
 * `{ subHandle: null, error: null }` while the derivation is in
 * flight. Failures no longer go only to the console (R7 resolved).
 */
export function useSubHandle(
  handleName: string,
  subName: string
): SubHandleResult {
  const { identity } = useMe2emContext();
  const [result, setResult] = useState<SubHandleResult>({
    subHandle: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- terminal NO_IDENTITY state when identity is gone; set-during-render refactor is a tracked post-rc.2 follow-up
      setResult({ subHandle: null, error: NO_IDENTITY_ERROR });
      return;
    }
    identity
      .deriveSubHandle(handleName, subName)
      .then((h) => {
        if (!cancelled) setResult({ subHandle: h, error: null });
      })
      .catch((err) => {
        if (!cancelled) setResult({ subHandle: null, error: toHookError(err) });
      });
    return () => { cancelled = true; };
  }, [identity, handleName, subName]);

  return result;
}
