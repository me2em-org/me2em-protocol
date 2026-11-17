// packages/x402/src/me2em-extra.ts
//
// `extra.me2em` — the Me2eM extension nested inside x402
// `PaymentRequirements.extra` (ТЗ @me2em/x402 v1.2 §3.6). The nested key
// means the x402-reserved extra keys (`name`, `version`,
// `assetTransferMethod`, `paymentFlow`) are never touched.
//
// Two formats, two names (ТЗ §3.6): core exports `Me2emExtra` — the
// application-side shape (all fields optional, `agreementProof?: Uint8Array`);
// this module exports `X402Me2emExtra` — the wire shape (`sellerId`
// required, `agreementProof?: string` in base64, `me2emError?`).
//
// Writes validate (fail-fast `ME2EM_EXTRA_INVALID`); reads are
// fail-tolerant — anything that is not a well-formed `extra.me2em`
// returns `null`, never throws (ТЗ §3.6: «не падать на чужих extra»).

import type { Me2emErrorCode, X402PaymentRequirements } from '@me2em/core';
import { ME2EM_ERROR_CODES, X402Error } from './errors.js';

/** The nested extra key used by Me2eM (ТЗ §3.6). */
export const X402_ME2EM_EXTRA_KEY = 'me2em';

/**
 * x402-reserved `extra` keys (upstream §5.1.2, §6.1) — never overwritten
 * by {@link withMe2emExtra}, which only writes the nested `me2em` key.
 */
export const X402_RESERVED_EXTRA_KEYS = [
  'assetTransferMethod',
  'paymentFlow',
  'name',
  'version',
] as const;

/**
 * The wire form of the Me2eM extension (ТЗ §3.6). `agreementProof` is an
 * opaque artifact — base64 of the application's `Uint8Array`; x402 never
 * interprets it (ТЗ §0.5).
 */
export interface X402Me2emExtra {
  /** The seller identity — non-empty. */
  readonly sellerId: string;
  readonly buyerId?: string;
  readonly memo?: string;
  readonly reference?: string;
  /** base64 of the Pact proof (`Uint8Array` on the application side). */
  readonly agreementProof?: string;
  /** Me2eM protocol failure code, when the failure is protocol-level. */
  readonly me2emError?: Me2emErrorCode;
  readonly [key: string]: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateExtra(extra: X402Me2emExtra): void {
  if (typeof extra.sellerId !== 'string' || extra.sellerId.length === 0) {
    throw new X402Error('ME2EM_EXTRA_INVALID', 'extra.me2em.sellerId must be a non-empty string');
  }
  for (const field of ['buyerId', 'memo', 'reference', 'agreementProof'] as const) {
    const value = extra[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new X402Error('ME2EM_EXTRA_INVALID', `extra.me2em.${field} must be a string when present`);
    }
  }
  if (extra.me2emError !== undefined && !ME2EM_ERROR_CODES.includes(extra.me2emError)) {
    throw new X402Error(
      'ME2EM_EXTRA_INVALID',
      `extra.me2em.me2emError ${JSON.stringify(extra.me2emError)} is not a Me2emErrorCode (unknown enums fail closed, ТЗ §0.7)`
    );
  }
}

/**
 * Returns `req` with `extra.me2em` set/merged. Merge semantics (ТЗ §3.6):
 * existing `extra.me2em` fields survive, the values passed here win on
 * conflict; everything else in `extra` (including the reserved keys) is
 * preserved. Throws `X402Error('ME2EM_EXTRA_INVALID')` on a malformed
 * `extra` / `extra.me2em` or an invalid field value.
 */
export function withMe2emExtra(
  req: X402PaymentRequirements,
  extra: X402Me2emExtra
): X402PaymentRequirements {
  validateExtra(extra);
  if (req.extra !== undefined && !isPlainObject(req.extra)) {
    throw new X402Error('ME2EM_EXTRA_INVALID', 'requirements.extra must be a plain object when present');
  }
  const existing = (req.extra ?? {}) as Record<string, unknown>;
  const existingMe2em = existing[X402_ME2EM_EXTRA_KEY];
  if (existingMe2em !== undefined && !isPlainObject(existingMe2em)) {
    throw new X402Error('ME2EM_EXTRA_INVALID', 'existing requirements.extra.me2em must be a plain object');
  }
  return {
    ...req,
    extra: {
      ...existing,
      [X402_ME2EM_EXTRA_KEY]: { ...(existingMe2em ?? {}), ...extra },
    },
  };
}

/**
 * Reads **only** the nested `extra.me2em` (ТЗ §3.6: чужие top-level
 * `extra.sellerId` и т.п. игнорируются). Returns `null` when the header
 * carries no Me2eM extension or its `sellerId` is not a non-empty
 * string — a malformed Me2eM extra is the seller's problem, not a
 * transport error.
 */
export function readMe2emExtra(req: X402PaymentRequirements): X402Me2emExtra | null {
  if (!isPlainObject(req.extra)) return null;
  const me2em = req.extra[X402_ME2EM_EXTRA_KEY];
  if (!isPlainObject(me2em)) return null;
  if (typeof me2em.sellerId !== 'string' || me2em.sellerId.length === 0) return null;
  return me2em as X402Me2emExtra;
}
