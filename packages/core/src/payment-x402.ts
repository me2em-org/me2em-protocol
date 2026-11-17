// payment-x402.ts
//
// x402 v2 wire types and structural guards (ТЗ @me2em/x402 v1.1 §2.1).
//
// Dependency-leaf: imports only `parseChain` from `payment.js`.
// No runtime dependencies, no network code — pure types and guards.
//
// These are WIRE data shapes from the x402 v2 specification. They are
// carried in @me2em/core so that @me2em/x402 (M1) and chain packages
// (M2, via `PaymentSigner`) share one definition. Core does not
// interpret them logically; guards are structural only.

import { parseChain } from './payment.js';

/** The x402 protocol version carried in every wire message. */
export const X402_VERSION = 2;

/**
 * Resource descriptor inside an x402 v2 `PaymentRequired` response:
 * what is being sold and how it is presented (ТЗ x402 v1.1 §2.1).
 */
export interface X402ResourceInfo {
  /** Absolute http(s) URL of the resource. */
  readonly url: string;
  /** Human-readable description of the resource. */
  readonly description?: string;
  /** MIME type of the resource (e.g. `application/json`). */
  readonly mimeType?: string;
  /** Printable-ASCII service name, at most 32 characters. */
  readonly serviceName?: string;
  /** Free-form tags, at most 5, each at most 32 characters. */
  readonly tags?: readonly string[];
  /** Absolute http(s) icon URL, at most 2048 characters. */
  readonly iconUrl?: string;
}

/**
 * One payment option inside `PaymentRequired.accepts` (ТЗ x402 v1.1 §2.1).
 * `amount` is in atomic units (smallest denomination), a decimal string.
 */
export interface X402PaymentRequirements {
  /** x402 execution scheme: `exact`, `eip3009`, `permit2-exact`, … */
  readonly scheme: string;
  /** Exact CAIP-2 chain id (validated with `parseChain`). */
  readonly network: string;
  /** Amount in atomic units — decimal string matching `/^[0-9]+$/`. */
  readonly amount: string;
  /** Asset identifier: contract address or ISO 4217 code. */
  readonly asset: string;
  /** Recipient address on `network`. */
  readonly payTo: string;
  /** Maximum settlement timeout in seconds — integer ≥ 1. */
  readonly maxTimeoutSeconds: number;
  /** Scheme-specific and extension metadata. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * The x402 v2 `402 Payment Required` response body (ТЗ x402 v1.1 §2.1).
 */
export interface X402PaymentRequired {
  /** Always `2` for the v2 wire format. */
  readonly x402Version: 2;
  /** Optional machine-readable error context. */
  readonly error?: string;
  /** The resource being sold. */
  readonly resource: X402ResourceInfo;
  /** Non-empty list of acceptable payment options. */
  readonly accepts: readonly X402PaymentRequirements[];
  /** Protocol extensions keyed by name. */
  readonly extensions?: Readonly<Record<string, { info: object; schema: object }>>;
}

/**
 * The buyer-signed `PAYMENT-SIGNATURE` header payload (ТЗ x402 v1.1 §2.1):
 * the echoed accepted requirements plus the scheme-specific payload.
 */
export interface X402PaymentPayload {
  /** Always `2` for the v2 wire format. */
  readonly x402Version: 2;
  /** Optional resource echo. */
  readonly resource?: X402ResourceInfo;
  /** The accepted payment option (echoed from `accepts`). */
  readonly accepted: X402PaymentRequirements;
  /** Scheme-specific payload (e.g. signed transfer fields). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Protocol extensions keyed by name. */
  readonly extensions?: Readonly<Record<string, { info: object; schema: object }>>;
}

/**
 * The `PAYMENT-RESPONSE` header: the result of a `settle` call
 * (ТЗ x402 v1.1 §2.1).
 */
export interface X402SettleResponse {
  /** Whether the payment settled successfully. */
  readonly success: boolean;
  /** Machine-readable failure reason (present on failure). */
  readonly errorReason?: string;
  /** Human-readable failure message (present on failure). */
  readonly errorMessage?: string;
  /** Payer address, when known. */
  readonly payer?: string;
  /**
   * Settlement transaction reference. Empty string is legal when no
   * transaction was broadcast (upstream §5.3.2) — except for
   * `errorReason: 'settlement_pending'`, where it MUST be non-empty.
   */
  readonly transaction: string;
  /** Blockchain network identifier in CAIP-2 format. */
  readonly network: string;
  /** Settled amount in atomic units. */
  readonly amount?: string;
  /** Scheme-specific extras. */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Protocol extensions keyed by name. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * The result of a `verify` call (ТЗ x402 v1.1 §2.1).
 */
export interface X402VerifyResponse {
  /** Whether the payment payload is valid. */
  readonly isValid: boolean;
  /** Machine-readable invalidity reason (present when invalid). */
  readonly invalidReason?: string;
  /** Human-readable invalidity message (present when invalid). */
  readonly invalidMessage?: string;
  /** Payer address, when known. */
  readonly payer?: string;
  /** Protocol extensions keyed by name. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** Scheme-specific extras. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * The result of a `supported` call: which (version, scheme, network)
 * triples the facilitator can handle (ТЗ x402 v1.1 §2.1).
 */
export interface X402Supported {
  /** Supported (version, scheme, network) combinations. */
  readonly kinds: ReadonlyArray<{
    readonly x402Version: number;
    readonly scheme: string;
    readonly network: string;
  }>;
  /** Supported extension names. */
  readonly extensions?: readonly string[];
  /** Supported signers keyed by scheme. */
  readonly signers?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Me2eM-specific payment failure codes — a subset of
 * `PaymentFailureReason` (ТЗ x402 v1.1 §2.2).
 */
export type Me2emErrorCode =
  | 'REFERENCE_MISMATCH'
  | 'PACT_INVALID'
  | 'BUYER_NOT_ATTESTED'
  | 'SELLER_NOT_ATTESTED';

/**
 * Application-declared buyer attestation policy (ТЗ x402 v1.1 §2.3).
 * x402 does not enforce it — a contradictory configuration fails fast
 * in `@me2em/x402` instead.
 */
export const BUYER_ATTESTATION_POLICY = {
  NONE: 'none',
  OPTIONAL: 'optional',
  REQUIRED: 'required',
} as const;
export type BuyerAttestationPolicy =
  typeof BUYER_ATTESTATION_POLICY[keyof typeof BUYER_ATTESTATION_POLICY];

/**
 * Application-declared compliance regime (ТЗ x402 v1.1 §2.3).
 * x402 does not enforce it — declaration only.
 */
export const REGULATORY_PROFILES = {
  NONE: 'none',
  KYC: 'kyc',
  AML: 'aml',
  AGE_GATED: 'age-gated',
  SANCTIONS: 'sanctions',
} as const;
export type RegulatoryProfile =
  typeof REGULATORY_PROFILES[keyof typeof REGULATORY_PROFILES];

// ---------------------------------------------------------------------------
// Structural guards — never throw, always return a boolean.
// ---------------------------------------------------------------------------

const AMOUNT_RE = /^[0-9]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/**
 * Structural guard for {@link X402PaymentRequirements}. Additionally
 * validates that `network` is a well-formed CAIP-2 chain id.
 */
export function isX402PaymentRequirements(value: unknown): value is X402PaymentRequirements {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.scheme)) return false;
  if (typeof value.network !== 'string' || parseChain(value.network) === null) return false;
  if (typeof value.amount !== 'string' || !AMOUNT_RE.test(value.amount)) return false;
  if (!isNonEmptyString(value.asset)) return false;
  if (!isNonEmptyString(value.payTo)) return false;
  if (!isPositiveInteger(value.maxTimeoutSeconds)) return false;
  if (value.extra !== undefined && !isPlainObject(value.extra)) return false;
  return true;
}

/**
 * Structural guard for {@link X402ResourceInfo}.
 */
function isX402ResourceInfo(value: unknown): value is X402ResourceInfo {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.url)) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false;
  if (value.serviceName !== undefined && typeof value.serviceName !== 'string') return false;
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every((t) => typeof t === 'string'))) return false;
  if (value.iconUrl !== undefined && typeof value.iconUrl !== 'string') return false;
  return true;
}

/**
 * Structural guard for {@link X402PaymentRequired}.
 */
export function isX402PaymentRequired(value: unknown): value is X402PaymentRequired {
  if (!isPlainObject(value)) return false;
  if (value.x402Version !== 2) return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  if (!isX402ResourceInfo(value.resource)) return false;
  if (!Array.isArray(value.accepts) || value.accepts.length === 0) return false;
  for (const req of value.accepts) {
    if (!isX402PaymentRequirements(req)) return false;
  }
  if (value.extensions !== undefined && !isPlainObject(value.extensions)) return false;
  return true;
}

/**
 * Structural guard for {@link X402PaymentPayload}.
 */
export function isX402PaymentPayload(value: unknown): value is X402PaymentPayload {
  if (!isPlainObject(value)) return false;
  if (value.x402Version !== 2) return false;
  if (value.resource !== undefined && !isX402ResourceInfo(value.resource)) return false;
  if (!isX402PaymentRequirements(value.accepted)) return false;
  if (!isPlainObject(value.payload)) return false;
  if (value.extensions !== undefined && !isPlainObject(value.extensions)) return false;
  return true;
}

/**
 * Structural guard for {@link X402SettleResponse}.
 */
export function isX402SettleResponse(value: unknown): value is X402SettleResponse {
  if (!isPlainObject(value)) return false;
  if (typeof value.success !== 'boolean') return false;
  if (value.errorReason !== undefined && typeof value.errorReason !== 'string') return false;
  if (value.errorMessage !== undefined && typeof value.errorMessage !== 'string') return false;
  if (value.payer !== undefined && typeof value.payer !== 'string') return false;
  // Upstream §5.3.2: an empty transaction is legal when nothing was
  // broadcast; it MUST be non-empty for `errorReason: settlement_pending`.
  if (typeof value.transaction !== 'string') return false;
  if (value.transaction === '' && value.errorReason === 'settlement_pending') return false;
  if (typeof value.network !== 'string' || parseChain(value.network) === null) return false;
  if (value.amount !== undefined && (typeof value.amount !== 'string' || !AMOUNT_RE.test(value.amount))) return false;
  if (value.extra !== undefined && !isPlainObject(value.extra)) return false;
  if (value.extensions !== undefined && !isPlainObject(value.extensions)) return false;
  return true;
}

/**
 * Structural guard for {@link X402VerifyResponse}.
 */
export function isX402VerifyResponse(value: unknown): value is X402VerifyResponse {
  if (!isPlainObject(value)) return false;
  if (typeof value.isValid !== 'boolean') return false;
  if (value.invalidReason !== undefined && typeof value.invalidReason !== 'string') return false;
  if (value.invalidMessage !== undefined && typeof value.invalidMessage !== 'string') return false;
  if (value.payer !== undefined && typeof value.payer !== 'string') return false;
  if (value.extensions !== undefined && !isPlainObject(value.extensions)) return false;
  if (value.extra !== undefined && !isPlainObject(value.extra)) return false;
  return true;
}

/**
 * Structural guard for {@link X402Supported}.
 */
export function isX402Supported(value: unknown): value is X402Supported {
  if (!isPlainObject(value)) return false;
  if (!Array.isArray(value.kinds)) return false;
  for (const kind of value.kinds) {
    if (!isPlainObject(kind)) return false;
    if (typeof kind.x402Version !== 'number') return false;
    if (!isNonEmptyString(kind.scheme)) return false;
    if (!isNonEmptyString(kind.network)) return false;
  }
  if (value.extensions !== undefined && (!Array.isArray(value.extensions) || !value.extensions.every((e) => typeof e === 'string'))) return false;
  if (value.signers !== undefined && !isPlainObject(value.signers)) return false;
  return true;
}
