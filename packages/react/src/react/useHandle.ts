// packages/react/src/react/useHandle.ts
import { useState, useEffect } from 'react';
import { useMe2emContext } from './context.js';
import {
  toHookError,
  type HandleResult,
  type Me2emHookError,
} from './hook-results.js';

const NO_IDENTITY_ERROR: Me2emHookError = {
  code: 'NO_IDENTITY',
  message: 'No activated identity in Me2emProvider',
};

/**
 * Derives the named Handle for the active identity.
 *
 * Structured result (BL-50, v1.1 — early break accepted 2026-11-04):
 * the hook returns `{ handle, error: null }` on success,
 * `{ handle: null, error }` on failure — `error.code` is
 * machine-readable (`AttestationErrorCode` from core, plus
 * `NO_IDENTITY` when the provider has no activated identity and
 * `UNKNOWN` for failures outside the core error model) — and
 * `{ handle: null, error: null }` while the derivation is in flight.
 * Failures no longer go only to the console (R7 resolved).
 */
export function useHandle(name: string): HandleResult {
  const { identity } = useMe2emContext();
  const [result, setResult] = useState<HandleResult>({
    handle: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!identity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- terminal NO_IDENTITY state when identity is gone; set-during-render refactor is a tracked post-rc.2 follow-up
      setResult({ handle: null, error: NO_IDENTITY_ERROR });
      return;
    }
    // Core performs full name canonicalization (NFKC, lowercase,
    // trim) and validation — no local normalization here.
    identity.deriveHandle(name).then((h) => {
      if (!cancelled) setResult({ handle: h, error: null });
    }).catch((err) => {
      if (!cancelled) setResult({ handle: null, error: toHookError(err) });
    });
    return () => { cancelled = true; };
  }, [identity, name]);

  return result;
}
