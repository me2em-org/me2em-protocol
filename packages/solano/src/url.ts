// packages/solano/src/url.ts
//
// Solana Pay request URLs (Документ 2 v1.2 §5.1): the hand-off format
// for EXTERNAL wallets (Phantom, Solflare — browser extensions do not
// go through `pay`). The URL follows the Solana Pay URI specification:
//
//   solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>
//
// Boundary note (v1.2 §0.1): the URL is a CONVENIENCE TRANSPORT, not
// the verification artifact. `expiresAt` is deliberately NOT encoded
// — wallets have no use for it; the verifier enforces expiry from the
// SIGNED `PaymentRequest` (block time first, observed time as
// fallback — Ф4). All verification parameters live in signed data.

import type { PaymentRequest } from '@me2em/core';
import { isValidSolanaAddress } from './adapter.js';
import { isSolanaChain } from './networks.js';

/**
 * The sentinel `PaymentRequest.asset` value for the chain-native
 * asset (SOL). Exact lowercase match — SPL mints are case-sensitive
 * base58 and are always 32-byte values, so no mint can collide with
 * the sentinel. Anything else is treated as an SPL mint (base58).
 */
export const SOLANA_NATIVE_ASSET = 'sol';

/**
 * Non-negative decimal amount per the core `PaymentRequest` contract
 * ("decimal string in whole token units, NOT the smallest
 * denomination"): `0`, `5`, `0.5`, `12.75` — no sign, no exponent,
 * no separators, no leading zeros (`01` is rejected, `0` is not).
 */
const AMOUNT_RE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Encodes a Solana `PaymentRequest` as a Solana Pay URI for external
 * wallets (Phantom acceptance flow, v1.2 §5.1):
 *
 * - `solana:<payTo>` — recipient (base58; URI-safe as-is).
 * - `amount` — decimal string in whole units, always present.
 * - `spl-token` — present exactly when `asset` is an SPL mint;
 *   absent for the native sentinel {@link SOLANA_NATIVE_ASSET}.
 * - `reference` — the correlation key for chain-level replay
 *   detection (one value; see `createPaymentReference`).
 *
 * Parameters are emitted in the Solana Pay specification order
 * (`amount`, `spl-token`, `reference`) so URLs are deterministic —
 * the same request encodes to the same string.
 *
 * @throws {TypeError} if `chain` is not a Solana CAIP-2 id, `payTo`
 *   is not a base58-encoded 32-byte address, `amount` is not a
 *   non-negative decimal string, `asset` is neither the native
 *   sentinel nor a base58-encoded 32-byte SPL mint, or `reference`
 *   is not a base58-encoded 32-byte key.
 */
export function createPaymentRequestURL(request: PaymentRequest): string {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('createPaymentRequestURL: request must be an object');
  }
  if (!isSolanaChain(request.chain)) {
    throw new TypeError(
      `createPaymentRequestURL: request.chain must be a Solana CAIP-2 chain id (e.g. 'solana:mainnet-beta'), got ${JSON.stringify(request.chain)}`
    );
  }
  if (!isValidSolanaAddress(request.payTo)) {
    throw new TypeError(
      'createPaymentRequestURL: request.payTo must be a base58-encoded 32-byte Solana address'
    );
  }
  if (typeof request.amount !== 'string' || !AMOUNT_RE.test(request.amount)) {
    throw new TypeError(
      `createPaymentRequestURL: request.amount must be a non-negative decimal string in whole token units, got ${JSON.stringify(request.amount)}`
    );
  }
  if (typeof request.asset !== 'string' || request.asset.length === 0) {
    throw new TypeError(
      `createPaymentRequestURL: request.asset must be a non-empty string (the native sentinel 'sol' or an SPL mint), got ${JSON.stringify(request.asset)}`
    );
  }
  if (request.asset !== SOLANA_NATIVE_ASSET && !isValidSolanaAddress(request.asset)) {
    throw new TypeError(
      `createPaymentRequestURL: request.asset must be the native sentinel 'sol' or a base58-encoded 32-byte SPL mint, got ${JSON.stringify(request.asset)}`
    );
  }
  if (!isValidSolanaAddress(request.reference)) {
    throw new TypeError(
      'createPaymentRequestURL: request.reference must be a base58-encoded 32-byte reference key'
    );
  }

  // Solana Pay URI parameter order: amount, spl-token, reference,
  // then label/message/memo (not modelled by PaymentRequest).
  const params: string[] = [`amount=${encodeURIComponent(request.amount)}`];
  if (request.asset !== SOLANA_NATIVE_ASSET) {
    params.push(`spl-token=${encodeURIComponent(request.asset)}`);
  }
  params.push(`reference=${encodeURIComponent(request.reference)}`);

  return `solana:${encodeURIComponent(request.payTo)}?${params.join('&')}`;
}
