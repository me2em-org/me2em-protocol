// packages/x402/src/codec.ts
//
// Base64-JSON codec for the three x402 v2 wire headers (ТЗ @me2em/x402
// v1.2 §3.2): `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`.
// Structural validation is delegated to the `@me2em/core` guards — core
// is the single source of the wire shapes.
//
// Fail-closed rules (ТЗ §0.7, §3.2):
// - decode: invalid base64 / non-UTF-8 / non-JSON / structural mismatch
//   → `X402Error` `…_MALFORMED`; well-formed JSON with a numeric
//   `x402Version !== 2` → `X402Error` `VERSION_UNSUPPORTED`;
// - encode: oversized header → `TypeError` (programmer error); the same
//   limit on decode → `…_MALFORMED` (hostile input).

import {
  X402_VERSION,
  isX402PaymentPayload,
  isX402PaymentRequired,
  isX402SettleResponse,
  type X402PaymentPayload,
  type X402PaymentRequired,
  type X402SettleResponse,
} from '@me2em/core';
import { X402Error, type X402ErrorCode } from './errors.js';

export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

/** Default header-value size limit — the 8 KiB proxy rule of thumb (ТЗ §3.2). */
export const DEFAULT_MAX_HEADER_BYTES = 8192;

export interface HeaderSizeOptions {
  /** Header-value size limit in bytes; default {@link DEFAULT_MAX_HEADER_BYTES}. */
  readonly maxHeaderBytes?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function maxBytes(opts?: HeaderSizeOptions): number {
  const value = opts?.maxHeaderBytes;
  if (value === undefined) return DEFAULT_MAX_HEADER_BYTES;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`maxHeaderBytes must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** base64 (with or without padding) → bytes. Throws TypeError on garbage. */
function fromBase64(header: string): Uint8Array {
  const compact = header.trim();
  if (compact.length === 0) throw new TypeError('empty base64 value');
  const padded = compact + '='.repeat((4 - (compact.length % 4)) % 4);
  const binary = atob(padded); // throws on invalid characters / impossible length
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function encodeWire(value: object, what: string, opts?: HeaderSizeOptions): string {
  const limit = maxBytes(opts);
  const wire = toBase64(encoder.encode(JSON.stringify(value)));
  const size = byteLength(wire);
  if (size > limit) {
    throw new TypeError(`${what} header value exceeds the ${limit}-byte limit (${size} bytes)`);
  }
  return wire;
}

function decodeJson(header: string, code: X402ErrorCode, opts?: HeaderSizeOptions): unknown {
  const limit = maxBytes(opts);
  if (byteLength(header) > limit) {
    throw new X402Error(code, `header value exceeds the ${limit}-byte limit`);
  }
  let json: string;
  try {
    json = decoder.decode(fromBase64(header));
  } catch (e) {
    throw new X402Error(code, 'header value is not valid base64/UTF-8', { cause: String(e) });
  }
  try {
    return JSON.parse(json) as unknown;
  } catch (e) {
    throw new X402Error(code, 'header value is not valid JSON', { cause: String(e) });
  }
}

/**
 * A well-formed JSON object with a numeric `x402Version !== 2` is a
 * protocol-version failure, not a structural one (ТЗ §3.7: v1 payloads
 * are refused, never interpreted). A missing / non-numeric version is a
 * structural mismatch — the guards reject it as malformed.
 */
function assertSupportedVersion(obj: unknown): void {
  if (obj !== null && typeof obj === 'object' && 'x402Version' in obj) {
    const version = (obj as { x402Version?: unknown }).x402Version;
    if (typeof version === 'number' && version !== X402_VERSION) {
      throw new X402Error(
        'VERSION_UNSUPPORTED',
        `x402Version ${version} is not supported — this package speaks v${X402_VERSION} only`,
        { x402Version: version }
      );
    }
  }
}

/** Encodes the 402 body for the `PAYMENT-REQUIRED` response header. */
export function encodePaymentRequired(pr: X402PaymentRequired, opts?: HeaderSizeOptions): string {
  if (!isX402PaymentRequired(pr)) {
    throw new TypeError('encodePaymentRequired: value is not an X402PaymentRequired');
  }
  return encodeWire(pr, PAYMENT_REQUIRED_HEADER, opts);
}

/** Decodes and structurally validates a `PAYMENT-REQUIRED` header value. */
export function decodePaymentRequired(header: string, opts?: HeaderSizeOptions): X402PaymentRequired {
  const obj = decodeJson(header, 'PAYMENT_REQUIRED_MALFORMED', opts);
  assertSupportedVersion(obj);
  if (!isX402PaymentRequired(obj)) {
    throw new X402Error('PAYMENT_REQUIRED_MALFORMED', 'decoded value is not an X402PaymentRequired');
  }
  return obj;
}

/** Encodes the buyer's payload for the `PAYMENT-SIGNATURE` request header. */
export function encodePaymentPayload(p: X402PaymentPayload, opts?: HeaderSizeOptions): string {
  if (!isX402PaymentPayload(p)) {
    throw new TypeError('encodePaymentPayload: value is not an X402PaymentPayload');
  }
  return encodeWire(p, PAYMENT_SIGNATURE_HEADER, opts);
}

/** Decodes and structurally validates a `PAYMENT-SIGNATURE` header value. */
export function decodePaymentPayload(header: string, opts?: HeaderSizeOptions): X402PaymentPayload {
  const obj = decodeJson(header, 'PAYMENT_PAYLOAD_MALFORMED', opts);
  assertSupportedVersion(obj);
  if (!isX402PaymentPayload(obj)) {
    throw new X402Error('PAYMENT_PAYLOAD_MALFORMED', 'decoded value is not an X402PaymentPayload');
  }
  return obj;
}

/** Encodes a settle result for the `PAYMENT-RESPONSE` response header. */
export function encodeSettleResponse(s: X402SettleResponse, opts?: HeaderSizeOptions): string {
  if (!isX402SettleResponse(s)) {
    throw new TypeError('encodeSettleResponse: value is not an X402SettleResponse');
  }
  return encodeWire(s, PAYMENT_RESPONSE_HEADER, opts);
}

/** Decodes and structurally validates a `PAYMENT-RESPONSE` header value. */
export function decodeSettleResponse(header: string, opts?: HeaderSizeOptions): X402SettleResponse {
  const obj = decodeJson(header, 'PAYMENT_RESPONSE_MALFORMED', opts);
  if (!isX402SettleResponse(obj)) {
    throw new X402Error('PAYMENT_RESPONSE_MALFORMED', 'decoded value is not an X402SettleResponse');
  }
  return obj;
}
