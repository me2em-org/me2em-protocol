// packages/x402/src/client.ts
//
// The buyer side of the x402 v2 transport (ТЗ @me2em/x402 v1.2 §3.3).
// `createPaymentFetch` wraps `fetch`: free resources pass through; a 402
// carries `PAYMENT-REQUIRED`, the viable option is signed by the injected
// `PaymentSigner` and replayed exactly once as `PAYMENT-SIGNATURE`.
//
// Fail-closed (ТЗ §3.3): a 402 without a parseable `PAYMENT-REQUIRED` is
// an error — never a "pay the old way"; no viable option →
// `NO_VIABLE_OPTION` (before `signPayment` is called); a signer refusal →
// `SIGNER_REJECTED`. After the paid attempt there is no retry — the
// response comes back as-is whatever its status (never pay twice).

import {
  X402_VERSION,
  type PaymentSigner,
  type SignerCapability,
  type X402PaymentPayload,
  type X402PaymentRequirements,
  type X402SettleResponse,
} from '@me2em/core';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  decodePaymentRequired,
  decodeSettleResponse,
  encodePaymentPayload,
} from './codec.js';
import { X402Error } from './errors.js';

// `PaymentSigner` / `SignerCapability` moved to `@me2em/core` (rc.8):
// the contract is chain-agnostic, and chain packages must implement it
// without depending on the transport. Re-exported here so existing
// `@me2em/x402` imports keep working.
export type { PaymentSigner, SignerCapability };

export interface PaymentFetchOptions {
  /** The signer injected by the application. */
  readonly signer: PaymentSigner;
  /** Custom option picker; default: the first option covered by `capabilities`. */
  readonly selectRequirements?: (
    accepts: readonly X402PaymentRequirements[]
  ) => X402PaymentRequirements;
  /** Total attempts — default 2: the initial request + one with `PAYMENT-SIGNATURE`. */
  readonly maxAttempts?: number;
}

export type PaymentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_MAX_ATTEMPTS = 2;

function validateOptions(opts: PaymentFetchOptions): void {
  const signer = opts.signer as Partial<PaymentSigner> | undefined;
  if (
    !signer ||
    typeof signer !== 'object' ||
    !Array.isArray(signer.capabilities) ||
    typeof signer.signPayment !== 'function'
  ) {
    throw new TypeError(
      'createPaymentFetch: opts.signer must expose capabilities[] and a signPayment() function'
    );
  }
  if (opts.selectRequirements !== undefined && typeof opts.selectRequirements !== 'function') {
    throw new TypeError('createPaymentFetch: opts.selectRequirements must be a function when present');
  }
  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(max) || max < DEFAULT_MAX_ATTEMPTS) {
    throw new TypeError(
      `createPaymentFetch: opts.maxAttempts must be an integer >= ${DEFAULT_MAX_ATTEMPTS} (initial request + one paid attempt), got ${String(max)}`
    );
  }
}

function selectDefault(
  accepts: readonly X402PaymentRequirements[],
  capabilities: readonly SignerCapability[]
): X402PaymentRequirements | undefined {
  return accepts.find((req) =>
    capabilities.some((cap) => cap.scheme === req.scheme && cap.network === req.network)
  );
}

/**
 * Builds a payment-aware `fetch`. Signature: `(input, init?) => Promise<Response>`
 * — a drop-in for `fetch` (ТЗ §3.3).
 */
export function createPaymentFetch(opts: PaymentFetchOptions): PaymentFetch {
  validateOptions(opts);
  const { signer, selectRequirements } = opts;
  return async (input, init) => {
    const first = await fetch(input, init);
    // Rule 2/3 (ТЗ §3.3): 200 — pass through unsigned; anything that is
    // not a 402 is not our business.
    if (first.status !== 402) return first;

    const headerValue = first.headers.get(PAYMENT_REQUIRED_HEADER);
    if (headerValue === null) {
      // Rule 4: fail closed — never pay "the old way".
      throw new X402Error('PAYMENT_REQUIRED_MALFORMED', '402 response without a PAYMENT-REQUIRED header');
    }
    const required = decodePaymentRequired(headerValue);

    const accepted = selectRequirements
      ? selectRequirements(required.accepts)
      : selectDefault(required.accepts, signer.capabilities);
    if (accepted === undefined) {
      throw new X402Error(
        'NO_VIABLE_OPTION',
        'no accepts entry is covered by signer.capabilities (or the picker selected nothing)',
        { accepts: required.accepts.length }
      );
    }

    let schemePayload: Record<string, unknown>;
    try {
      schemePayload = await signer.signPayment(accepted, required.resource);
    } catch (e) {
      throw new X402Error('SIGNER_REJECTED', 'signPayment rejected the payment', { cause: e });
    }

    const payload: X402PaymentPayload = {
      x402Version: X402_VERSION,
      resource: required.resource,
      accepted,
      payload: schemePayload,
    };

    const headers = new Headers(init?.headers);
    headers.set(PAYMENT_SIGNATURE_HEADER, encodePaymentPayload(payload));
    // Rule 7: exactly one paid attempt — the response comes back as-is,
    // whatever its status.
    return fetch(input, { ...init, headers });
  };
}

/**
 * Reads the settlement from a response (ТЗ §3.3): `null` — no
 * `PAYMENT-RESPONSE` header; a broken header → `X402Error`
 * `PAYMENT_RESPONSE_MALFORMED` (fail closed — a broken settlement is
 * never silently treated as "no settlement").
 */
export function readSettlement(response: Response): X402SettleResponse | null {
  const headerValue = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (headerValue === null) return null;
  return decodeSettleResponse(headerValue);
}
