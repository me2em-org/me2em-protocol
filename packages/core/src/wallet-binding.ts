// wallet-binding.ts
//
// Default wallet-binding verification for the payment layer
// (Документ 2 v1.2 §6): the core default combines the attestation
// token's signature with subject agreement and address equality.
// Chain adapters MAY override `PaymentAdapter.verifyWalletBinding` with
// stronger checks (on-curve validation, Mode 1 re-derivation from
// `subjectWalletPath`); Mode 2 verifiers (root public key only) accept
// path↔address consistency on the strength of the Identity signature —
// a deliberate v1 limitation. Transport layers (x402) never invoke this
// implicitly; regulatory / compliance flows call it explicitly.
//
// This module lives apart from payment.ts so the runtime module graph
// stays acyclic: payment.ts is a leaf, attestation.ts imports payment.ts
// (fail-closed wallet validation), and only this module pulls in the
// Attestation class itself.

import { Attestation } from './attestation.js';
import type { WalletDescriptor, WalletEntityRef } from './payment.js';

/** Options for the default {@link verifyWalletBinding}. */
export interface WalletBindingOptions {
  /**
   * Ed25519 public key of the attestation ISSUER — the root Identity
   * public key for Identity→Handle attestations, the Handle public key
   * for Handle→SubHandle attestations.
   */
  issuerPublicKey: Uint8Array;
}

/**
 * Default wallet-binding check (v1.2 §6): answers "does this attestation
 * bind this wallet to this entity?".
 *
 * Order of the three fail-closed checks:
 *
 * 1. **Signature** — the token verifies against the expected issuer
 *    public key (`Attestation.verifySignature`).
 * 2. **Subject agreement** — the attestation must attest THIS entity
 *    (`payload.subjectId === entity.id`); without it any valid
 *    attestation of a different subject would "bind" its wallet here.
 * 3. **Address equality** — `payload.subjectWallet` string-equals the
 *    wallet address to be bound; an attestation without wallet fields
 *    fails (undefined never equals an address).
 *
 * On-curve checking and path re-derivation are NOT part of the default —
 * they are adapter overrides (Mode 1) per v1.2 §6/§6.1.
 *
 * @returns `false` on every failed check — never throws for a
 *   verification mismatch (only structural token errors surface as
 *   `AttestationError` from `verifySignature`/decode, per its contract).
 *
 * @example
 * ```ts
 * const ok = await verifyWalletBinding(wallet, entity, attestation, {
 *   issuerPublicKey: rootIdentity.getPublicKey(),
 * });
 * ```
 */
export async function verifyWalletBinding(
  wallet: WalletDescriptor,
  entity: WalletEntityRef,
  attestation: Attestation,
  opts: WalletBindingOptions
): Promise<boolean> {
  const signatureOk = await Attestation.verifySignature(attestation.token, opts.issuerPublicKey);
  if (!signatureOk) return false;
  if (attestation.payload.subjectId !== entity.id) return false;
  return attestation.payload.subjectWallet === wallet.address;
}
