// packages/x402/src/index.ts
//
// @me2em/x402 — the x402 v2 payment transport of the Me2eM payment
// layer (ТЗ @me2em/x402 v1.2, M1): header codec, payment-aware fetch
// client, server helpers, the facilitator contract and the `extra.me2em`
// extension. Pure transport — policy (attestation, Pact) stays with the
// application; `PaymentSigner` implementations live with the key owners
// (e.g. `@me2em/solana`, M2).
//
// The B402 HTTP facilitator client is opt-in: import it from `./b402` —
// the main entry stays free of any concrete facilitator (ТЗ §3.1).

export {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RESPONSE_HEADER,
  DEFAULT_MAX_HEADER_BYTES,
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentPayload,
  decodePaymentPayload,
  encodeSettleResponse,
  decodeSettleResponse,
  type HeaderSizeOptions,
} from './codec.js';
export {
  createPaymentFetch,
  readSettlement,
  type PaymentFetch,
  type PaymentFetchOptions,
  type PaymentSigner,
  type SignerCapability,
} from './client.js';
export {
  assertValidX402Config,
  paymentRequiredResponse,
  readPaymentHeader,
  settlementHeader,
  type X402Config,
} from './server.js';
export {
  FACILITATOR_PHASES,
  type FacilitatorAuth,
  type FacilitatorClient,
  type FacilitatorFailureKind,
  type FacilitatorOptions,
  type FacilitatorPhase,
} from './facilitator.js';
export {
  X402_ME2EM_EXTRA_KEY,
  X402_RESERVED_EXTRA_KEYS,
  readMe2emExtra,
  withMe2emExtra,
  type X402Me2emExtra,
} from './me2em-extra.js';
export { ME2EM_ERROR_CODES, X402ConfigError, X402Error, type X402ErrorCode } from './errors.js';
export { type Me2emErrorCode, type PaymentFailureReason } from '@me2em/core';
