// packages/x402/src/facilitator.ts
//
// The facilitator contract (ТЗ @me2em/x402 v1.2 §3.5): verify / settle /
// supported against an external service. Implementations live with their
// owners — `B402Facilitator` (subpath `./b402`) is the first HTTP client;
// for any other facilitator the application implements this interface
// directly (ТЗ §10.4). Interfaces only — zero runtime code in this module.

import type {
  X402PaymentPayload,
  X402PaymentRequirements,
  X402SettleResponse,
  X402Supported,
  X402VerifyResponse,
} from '@me2em/core';

/**
 * The external payment service behind the seller: read-only
 * verification, settlement and capability discovery (upstream x402 v2
 * §7). `verify` MUST NOT commit state; `settle` idempotency is the
 * seller's concern (ТЗ §3.5).
 */
export interface FacilitatorClient {
  /** Which (version, scheme, network) triples the facilitator handles. */
  supported(): Promise<X402Supported>;
  /** Read-only payment validation — no on-chain state (upstream §7.1). */
  verify(
    requirements: X402PaymentRequirements,
    payload: X402PaymentPayload
  ): Promise<X402VerifyResponse>;
  /** Payment settlement (upstream §7.2). */
  settle(
    requirements: X402PaymentRequirements,
    payload: X402PaymentPayload
  ): Promise<X402SettleResponse>;
}

/**
 * Auth is INJECTED — no credentials, keys or secrets live in
 * `@me2em/x402` (ТЗ §11). The factory form is called on every request
 * (JWT rotation).
 */
export interface FacilitatorAuth {
  readonly headers:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
}

export interface FacilitatorOptions {
  /** Base URL of the facilitator service, http(s). */
  readonly baseUrl: string;
  /** Auth injected per request. */
  readonly auth: FacilitatorAuth;
  /** Per-request timeout, ms. Default 10_000. */
  readonly timeoutMs?: number;
  /** Fetch replacement for tests. Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Failure kinds reported in `X402Error.details.kind` (ТЗ §3.5).
 * `http_4xx` and `invalid_response` are the M1 amendment: the ТЗ list
 * (`network|timeout|http_5xx|auth`) had no place for client-error
 * statuses or non-conforming response bodies — both must fail closed.
 */
export type FacilitatorFailureKind =
  | 'network'
  | 'timeout'
  | 'http_5xx'
  | 'http_4xx'
  | 'auth'
  | 'invalid_response';

/** The request phases, as a runtime list. */
export const FACILITATOR_PHASES = ['verify', 'settle', 'supported'] as const;
export type FacilitatorPhase = (typeof FACILITATOR_PHASES)[number];
