// packages/react/src/react/useSession.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Handle } from '@me2em/core';
import { Session, type SessionOptions, type SessionPayload } from '@me2em/core';
import { useMe2emContext } from './context.js';

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
 * fires at half the session TTL to create a fresh session with a new jti.
 *
 * On unmount, all timers are cleaned up to prevent state updates.
 *
 * Dependencies: `[handle, options]` — options are memoized via ref
 * to avoid unnecessary session recreation on every render.
 *
 * @param handle - The Handle to sign the session, or null.
 * @param options - Session options (audience, scopes, ttl).
 * @param autoRenew - Whether to auto-renew at half-life (default: true).
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
  const { identity } = useMe2emContext();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);

  // Update options ref without triggering re-renders
  optionsRef.current = options;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const renew = useCallback(() => {
    clearTimer();
    const opts = optionsRef.current;

    if (!handle) {
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
      setSession(s);
      setIsLoaded(true);
      setError(null);

      // Schedule auto-renewal at half-life
      if (autoRenew) {
        const halfLife = Math.floor((s.expiresAt * 1000 - Date.now()) / 2);
        if (halfLife > 0) {
          timerRef.current = setTimeout(() => {
            renew();
          }, Math.max(halfLife, 1000));
        }
      }
    }).catch((err) => {
      setSession(null);
      setIsLoaded(true);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [handle, autoRenew, clearTimer]);

  // Create session when handle or options change
  useEffect(() => {
    renew();
  }, [handle, renew]);

  return {
    session,
    isLoaded,
    error,
    isExpired: session ? session.isExpired() : false,
    renew,
  };
}
