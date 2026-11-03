// packages/react/src/react/hook-results.ts
//
// Structured derivation results (BL-50, v1.1 — early break accepted
// 2026-11-04): derivation hooks return a discriminated union instead of
// `Handle | null` / `SubHandle | null`, so apps can branch on the
// failure cause instead of parsing console output (R7 resolved).
import {
  AttestationError,
  type AttestationErrorCode,
  type Handle,
  type SubHandle,
} from '@me2em/core';

/**
 * Machine-readable code carried by {@link Me2emHookError}.
 *
 * Core codes pass through verbatim — the single source of truth is
 * `AttestationError.code` in `@me2em/core` (e.g. `DISPOSED` when the
 * identity was disposed mid-flight, `MALFORMED` for a
 * non-canonicalizable name). React-level codes: `NO_IDENTITY` — the
 * provider has no activated identity; `UNKNOWN` — a failure outside
 * the core error model.
 */
export type Me2emHookErrorCode = AttestationErrorCode | 'NO_IDENTITY' | 'UNKNOWN';

/**
 * Structured failure attached to a derivation hook result.
 * Match on `code`, never on `message` (specs/v1.0.md §7.2).
 */
export interface Me2emHookError {
  /** Machine-readable cause. */
  code: Me2emHookErrorCode;
  /** Human-readable description (core messages keep their `[level/code]` prefix). */
  message: string;
}

/**
 * Result of `useHandle` (BL-50): `{ handle, error: null }` on success,
 * `{ handle: null, error }` on failure, `{ handle: null, error: null }`
 * while the derivation is still in flight.
 */
export type HandleResult =
  | { handle: Handle; error: null }
  | { handle: null; error: Me2emHookError }
  | { handle: null; error: null };

/**
 * Result of `useSubHandle` (BL-50): same contract as {@link HandleResult}
 * with the derived value under `subHandle`.
 */
export type SubHandleResult =
  | { subHandle: SubHandle; error: null }
  | { subHandle: null; error: Me2emHookError }
  | { subHandle: null; error: null };

/** Maps an unknown rejection to the structured hook error. */
export function toHookError(err: unknown): Me2emHookError {
  if (err instanceof AttestationError) {
    return { code: err.code, message: err.message };
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  };
}
