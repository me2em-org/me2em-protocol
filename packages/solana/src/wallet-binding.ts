// packages/solana/src/wallet-binding.ts
//
// Solana on-curve wallet-binding check (Ф4, v1.2 §6.3).
//
// This is the ADAPTER OVERRIDE for `verifyWalletBinding`: it checks
// that `wallet.address` decodes to a valid on-curve ed25519 point.
// It does NOT replace core-default `verifyWalletBinding` (signature +
// subject + address equality). The application calls BOTH:
//
//   1. core-default: `verifyWalletBinding(wallet, entity, attestation, { issuerPublicKey })`
//   2. this: `verifyWalletBindingSolana(wallet)`
//
// Both must return `true` for a complete binding (v1.2 §6).
//
// Off-curve (PDA) addresses are deliberately rejected: a wallet must
// be a signer, which PDAs cannot be. (The structural
// `isValidAddress` in `adapter.ts` accepts PDAs — that's for
// destination checks; this function is for SOURCE wallet binding.)
//
// No dependencies beyond `@scure/base` and `@noble/curves`.

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import type { WalletDescriptor } from '@me2em/core';

/**
 * Solana on-curve wallet-binding check (Ф4).
 *
 * @returns `true` if `wallet.address` decodes to a valid on-curve
 *   ed25519 point; `false` otherwise (never throws).
 */
export function verifyWalletBindingSolana(wallet: WalletDescriptor): boolean {
  try {
    const bytes = base58.decode(wallet.address);
    if (bytes.length !== 32) return false;
    return ed25519.utils.isValidPublicKey(bytes);
  } catch {
    return false;
  }
}
