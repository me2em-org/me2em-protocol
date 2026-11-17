// packages/x402/src/errors.ts
//
// The error contract of `@me2em/x402` (ТЗ @me2em/x402 v1.2 §3.7): one
// class per layer — `X402Error` for wire/transport failures (fail-closed
// codes), `X402ConfigError` (TypeError semantics) for application
// configuration mistakes caught once at server start. `Me2emErrorCode` /
// `PaymentFailureReason` stay defined in `@me2em/core` and are
// re-exported as types only.

import type { Me2emErrorCode, PaymentFailureReason } from '@me2em/core';

/** Every fail-closed transport failure of `@me2em/x402`. */
export type X402ErrorCode =
  | 'PAYMENT_REQUIRED_MALFORMED'
  | 'PAYMENT_PAYLOAD_MALFORMED'
  | 'PAYMENT_RESPONSE_MALFORMED'
  | 'VERSION_UNSUPPORTED'
  | 'NO_VIABLE_OPTION'
  | 'SIGNER_REJECTED'
  | 'RESOURCE_MISMATCH'
  | 'FACILITATOR_ERROR'
  | 'SETTLEMENT_FAILED'
  | 'ME2EM_EXTRA_INVALID';

/**
 * Wire/transport failure (ТЗ §3.7). Fail-closed (ТЗ §0.7): an unknown
 * runtime `code` / `errorReason` / `me2emError` is never mapped to
 * success — it is surfaced through `details` and treated as a failure.
 */
export class X402Error extends Error {
  readonly code: X402ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: X402ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'X402Error';
    this.code = code;
    this.details = details;
  }
}

/**
 * Application configuration error (ТЗ §3.7) — TypeError semantics:
 * thrown once at server start from `assertValidX402Config`, never from
 * wire parsing.
 */
export class X402ConfigError extends TypeError {
  readonly code = 'CONFIG_INVALID';
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'X402ConfigError';
    this.details = details;
  }
}

/**
 * The Me2eM error codes as a runtime list — used to validate
 * `extra.me2em.me2emError` on write. The type annotation pins the list
 * to the core union: a typo is a compile error.
 */
export const ME2EM_ERROR_CODES: readonly Me2emErrorCode[] = [
  'REFERENCE_MISMATCH',
  'PACT_INVALID',
  'BUYER_NOT_ATTESTED',
  'SELLER_NOT_ATTESTED',
];

export type { Me2emErrorCode, PaymentFailureReason };
