// packages/solano/src/reference.ts
//
// Payment references (Документ 2 v1.2 §5.4): the correlation key a
// `PaymentRequest` carries for chain-level REPLAYED detection.
//
// For Solana the reference is a base58-encoded 32-byte value used as
// a read-only, non-signing account key on the payment transaction —
// `verifyPayment` (Ф4) keys REPLAYED on "more than one confirmed
// transfer with this reference" and REFERENCE_MISMATCH on "reference
// not contained in the transaction's account keys". A fresh random
// 32-byte value per request makes both checks stateless.

import { randomBytes } from '@me2em/crypto';
import { base58 } from '@scure/base';

/**
 * Creates a fresh payment reference: 32 random bytes (WebCrypto
 * `getRandomValues` via `@me2em/crypto`) base58-encoded.
 *
 * The value is a plain 32-byte key — it does NOT need to be a valid
 * on-curve Ed25519 point (it is never a signer; PDAs and arbitrary
 * keys are legitimate read-only account keys).
 *
 * Uniqueness discipline: one reference per `PaymentRequest`, never
 * reused across requests — reuse would be indistinguishable from a
 * replay. Generate at request-creation time, store with the order.
 */
export function createPaymentReference(): string {
  return base58.encode(randomBytes(32));
}
