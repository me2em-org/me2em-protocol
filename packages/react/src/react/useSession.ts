// packages/react/src/react/useSession.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Handle } from '@me2em/core';
import { Session } from '@me2em/core';

/**
 * Options for useSession, memoized via deep comparison of
 * `handle` and `options` refs on each render.
 *
 * @category Types
 */
export interface UseSessionOptions {
  /** Intended audience (recipient) of this session. */
  audience: string;
  /** Permission scopes granted in this session. */
  scopes: string[];
  /** Time-to-live in seconds. */
  ttl: number;
}

/**
 * Result of the useSession hook.
 *
 * @category Types
 */
export interface UseSessionResult {
  /** The active session, or null if no handle or session creation failed. */
  session: Session | null;
  /** Whether the session (or its absence) has been determined. */
  isLoaded: boolean;
  /** Error string if session creation or renewal failed. */
  error: string | null;
  /** Whether the current session has expired. */
  isExpired: boolean;
  /** Manually renew the session (creates a new one with a fresh jti). */
  renew: () => void;
}

/**
 * Hook that creates and manages a signed session token for a Handle.
 *
 * When `handle` is provided, creates a Session with the given options.
 * Supports auto-renewal: when `autoRenew` is true (default), a timer
 * fires at half the session TTL to create a fresh session with a new
 * jti (the previous token remains valid until its own expiry, but the
 * lineage identity is preserved through `handle`). Background tabs
 * throttle (clamped wakeups) or fully suspend timers, so on return to
 * visibility the hook additionally renews proactively when the session
 * is already past its half-life point (BL-51) — the overdue timer path
 * alone could leave the first user actions racing an expired session.
 *
 * On unmount, all timers are cleaned up to prevent state updates after
 * the component is gone.
 *
 * Dependencies: `[handle, renew]` — the options object is read through
 * a ref, so passing a fresh object literal on every render does NOT
 * re-trigger session creation. Only changes to `handle` (or to the
 * renewal function identity, which follows `handle`) do.
 *
 * @param handle - The Handle to sign the session, or null.
 * @param options - Session options (audience, scopes, ttl).
 * @param autoRenew - Whether to auto-renew at half-life (default: true).
 * @returns Session state with manual `renew` control.
 *
 * @example
 * ```ts
 * const handle = useHandle('my-handle');
 * const { session, isExpired, renew } = useSession(handle, {
 *   audience: 'app.example.com',
 *   scopes: ['read', 'write'],
 *   ttl: 3600,
 * });
 * ```
 */
export function useSession(
  handle: Handle | null,
  options: UseSessionOptions,
  autoRenew: boolean = true
): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  const mountedRef = useRef(true);

  // Mirror the latest options into the ref after every commit —
  // ref writes belong in effects, not during render (react-hooks/refs).
  useEffect(() => {
    optionsRef.current = options;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const renew = useCallback(() => {
    clearTimer();
    const opts = optionsRef.current;

    if (!handle) {
      if (!mountedRef.current) return;
      setSession(null);
      setIsLoaded(true);
      setError(null);
      return;
    }

    Session.create(handle, {
      audience: opts.audience,
      scopes: opts.scopes,
      ttl: opts.ttl,
    }).then((s) => {
      if (!mountedRef.current) return;
      setSession(s);
      setIsLoaded(true);
      setError(null);

      // Schedule auto-renewal at half-life
      if (autoRenew) {
        const halfLife = Math.floor((s.expiresAt * 1000 - Date.now()) / 2);
        if (halfLife > 0) {
          timerRef.current = setTimeout(() => {
            // eslint-disable-next-line react-hooks/immutability -- self-rescheduling renewal timer: the timer is cleared and re-created whenever renew itself changes (deps + clearTimer), so the captured binding is always the current one
            renew();
          }, Math.max(halfLife, 1000));
        }
      }
    }).catch((err) => {
      if (!mountedRef.current) return;
      setSession(null);
      setIsLoaded(true);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [handle, autoRenew, clearTimer]);

  // Create session when handle or options change
  useEffect(() => {
    if (mountedRef.current) {
      renew();
    }
  }, [handle, renew]);

  // BL-51: background tabs throttle (clamped wakeups) or fully
  // suspend timers (Memory Saver, mobile backgrounds), so the half-life
  // setTimeout alone can fire late — or not at all until the tab
  // resumes. When the document becomes visible again and the session
  // is already past its half-life point (expiresAt − ttl/2, the same
  // threshold the timer uses; expired is a superset), renew
  // proactively. renew() clears and reschedules the timer, so the
  // overdue timer cannot double-renew. autoRenew:false opts out
  // entirely, exactly like the timer path.
  useEffect(() => {
    if (!autoRenew || typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const s = session;
      if (!s) return;
      const halfLifePoint = (s.expiresAt - optionsRef.current.ttl / 2) * 1000;
      if (Date.now() >= halfLifePoint) {
        renew();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoRenew, renew, session]);

  return {
    session,
    isLoaded,
    error,
    isExpired: session ? session.isExpired() : false,
    renew,
  };
}
