// packages/x402/src/server.ts
//
// The seller side of the x402 v2 transport (ТЗ @me2em/x402 v1.2 §3.4,
// §3.10): build the 402, read the buyer's `PAYMENT-SIGNATURE`, emit
// `PAYMENT-RESPONSE`. Plus `assertValidX402Config` — the fail-fast
// policy check (ТЗ §3.10): declarations only, x402 never enforces
// attestation / Pact per payment; the recommended verify→resource→settle
// orchestration is the application's (ТЗ §3.4 table).

import {
  BUYER_ATTESTATION_POLICY,
  REGULATORY_PROFILES,
  isX402PaymentRequired,
  type BuyerAttestationPolicy,
  type RegulatoryProfile,
  type X402PaymentPayload,
  type X402PaymentRequired,
  type X402SettleResponse,
} from '@me2em/core';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  decodePaymentPayload,
  encodePaymentRequired,
  encodeSettleResponse,
} from './codec.js';
import { X402ConfigError, X402Error } from './errors.js';
import type { FacilitatorClient } from './facilitator.js';

/**
 * Builds a 402 `Response` with the base64 `PAYMENT-REQUIRED` header (ТЗ
 * §3.4). The body is the JSON of `PaymentRequired` (informative); extra
 * `ResponseInit` is merged (custom headers survive; `content-type`
 * defaults to `application/json`). Throws `TypeError` on a
 * structurally invalid `pr` or an oversized header value.
 */
export function paymentRequiredResponse(pr: X402PaymentRequired, init?: ResponseInit): Response {
  if (!isX402PaymentRequired(pr)) {
    throw new TypeError('paymentRequiredResponse: value is not an X402PaymentRequired');
  }
  const encoded = encodePaymentRequired(pr);
  const headers = new Headers(init?.headers);
  headers.set(PAYMENT_REQUIRED_HEADER, encoded);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(pr), { ...init, status: init?.status ?? 402, headers });
}

/**
 * Reads the buyer's `PAYMENT-SIGNATURE` header (ТЗ §3.4). `null` — the
 * header is absent (a plain unauthenticated request). When
 * `expectedResourceUrl` is given and the payload's `resource.url` does
 * not match — `X402Error` `RESOURCE_MISMATCH` (a payload for a
 * different resource must never be accepted).
 */
export function readPaymentHeader(headers: Headers, expectedResourceUrl?: string): X402PaymentPayload | null {
  const headerValue = headers.get(PAYMENT_SIGNATURE_HEADER);
  if (headerValue === null) return null;
  const payload = decodePaymentPayload(headerValue);
  if (expectedResourceUrl !== undefined && payload.resource?.url !== expectedResourceUrl) {
    throw new X402Error(
      'RESOURCE_MISMATCH',
      'PAYMENT-SIGNATURE carries a resource different from the request URL',
      { expected: expectedResourceUrl, received: payload.resource?.url ?? null }
    );
  }
  return payload;
}

/** `{ 'PAYMENT-RESPONSE': <base64> }` — spread into the final 2xx response (ТЗ §3.4). */
export function settlementHeader(settle: X402SettleResponse): Record<string, string> {
  return { [PAYMENT_RESPONSE_HEADER]: encodeSettleResponse(settle) };
}

/**
 * Server-side seller policy (ТЗ §3.10, final wording В2). Declarations
 * only — x402 does not enforce attestation or Pact per payment; the
 * client API (`createPaymentFetch`) does not take this config at all.
 */
export interface X402Config {
  /** The facilitator the application will call for verify/settle. */
  readonly facilitator: FacilitatorClient;
  /** `'stateless' | 'pact-aware' | 'auto'`. */
  readonly mode: 'stateless' | 'pact-aware' | 'auto';
  readonly buyerAttestationPolicy?: BuyerAttestationPolicy;
  readonly regulatoryProfile?: RegulatoryProfile;
  readonly defaultChain?: string;
  readonly defaultAsset?: string;
}

/**
 * Fail-fast config validation (ТЗ §3.10) — call once at server start.
 * Throws `X402ConfigError` (`code: 'CONFIG_INVALID'`, TypeError
 * semantics) on: a facilitator without callable verify/settle/supported;
 * an unknown `mode` / `buyerAttestationPolicy` / `regulatoryProfile`
 * (unknown enums fail closed, ТЗ §0.7); `mode: 'stateless'` combined
 * with a regulatory profile other than `'none'` (KYC/AML requires the
 * pact-aware flow).
 */
export function assertValidX402Config(config: X402Config): void {
  const facilitator = config.facilitator as Partial<FacilitatorClient> | undefined;
  if (
    !facilitator ||
    typeof facilitator !== 'object' ||
    typeof facilitator.verify !== 'function' ||
    typeof facilitator.settle !== 'function' ||
    typeof facilitator.supported !== 'function'
  ) {
    throw new X402ConfigError(
      'x402 config: facilitator must expose callable verify/settle/supported',
      { field: 'facilitator' }
    );
  }
  if (config.mode !== 'stateless' && config.mode !== 'pact-aware' && config.mode !== 'auto') {
    throw new X402ConfigError(`x402 config: unknown mode ${JSON.stringify(config.mode)}`, {
      field: 'mode',
    });
  }
  const policies = Object.values(BUYER_ATTESTATION_POLICY) as readonly string[];
  if (config.buyerAttestationPolicy !== undefined && !policies.includes(config.buyerAttestationPolicy)) {
    throw new X402ConfigError(
      `x402 config: unknown buyerAttestationPolicy ${JSON.stringify(config.buyerAttestationPolicy)}`,
      { field: 'buyerAttestationPolicy' }
    );
  }
  const profiles = Object.values(REGULATORY_PROFILES) as readonly string[];
  if (config.regulatoryProfile !== undefined && !profiles.includes(config.regulatoryProfile)) {
    throw new X402ConfigError(
      `x402 config: unknown regulatoryProfile ${JSON.stringify(config.regulatoryProfile)}`,
      { field: 'regulatoryProfile' }
    );
  }
  if (config.mode === 'stateless' && config.regulatoryProfile !== undefined && config.regulatoryProfile !== 'none') {
    throw new X402ConfigError(
      `x402 config: mode 'stateless' with regulatoryProfile ${JSON.stringify(config.regulatoryProfile)} — KYC/AML requires pact-aware mode`,
      { field: 'mode' }
    );
  }
}
