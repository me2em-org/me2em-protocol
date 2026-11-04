// packages/solano/src/adapter.ts
//
// SolanaWalletAdapter (Документ 2 v1.2 §2/§8) — the @me2em/core
// `WalletAdapter` implementation for one exact CAIP-2 chain id.
// The adapter is a STATELESS chain-bound view: derivation context is
// passed per call (`opts.seed`), so one class serves every network
// and `registerSolanaAdapters` registers one instance per chain key.
//
// Address validation is STRUCTURAL ONLY (base58 → exactly 32 bytes):
// Solana program-derived addresses (PDAs) are off-curve and are valid
// addresses, so no on-curve filter exists anywhere in this package.
// On-curve strengthening belongs to `verifyWalletBinding`
// (Ф4 scope, v1.2 §6).
//
// Error contract: a missing `opts.seed` (the adapter is deterministic
// and cannot resolve without it) is a programmer error → bare
// `TypeError`, matching the contract documented on core's
// `WalletAdapter.resolveWallet`.

import type { WalletAdapter, WalletDescriptor, WalletEntityRef } from '@me2em/core';
import { base58 } from '@scure/base';
import { secureWipe } from '@me2em/crypto';
import { isSolanaNetwork, solanaChain, type SolanaNetwork } from './networks.js';
import { nextPaymentIndex, SolanaWalletTree } from './wallet-tree.js';

/**
 * Structural validity of a Solana address: a non-empty base58 string
 * that decodes to exactly 32 bytes (an Ed25519 public key or a PDA).
 * Fail-closed: invalid alphabet characters (Solana addresses never
 * contain `0`, `O`, `I`, `l`), wrong lengths or non-string input
 * yield `false` — the function never throws.
 *
 * No on-curve check: PDAs are valid addresses (A4 carry-over).
 */
export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/**
 * The Solana `WalletAdapter` for one exact CAIP-2 chain id
 * (Документ 2 v1.2 §2/§8). Deterministic: `resolveWallet` derives the
 * payment wallet from the per-call 64-byte seed via
 * {@link SolanaWalletTree} at `opts.index` (default `0`).
 *
 * The adapter is stateless — no seed, no counter, no registry of used
 * paths. Index allocation is caller responsibility: persist the
 * `subjectWalletPath` values of your attestations and call
 * {@link SolanaWalletAdapter.nextIndex}.
 */
export class SolanaWalletAdapter implements WalletAdapter {
  /** Exact CAIP-2 chain id — also this adapter's registry key. */
  readonly chain: string;

  #network: SolanaNetwork;

  /**
   * @param network - One of the named Solana networks (whitelist —
   *   no free-form CAIP-2 references: registry keys are exact, so a
   *   typo must not silently create an unresolvable chain).
   * @throws {TypeError} on an unknown network name.
   */
  constructor(network: SolanaNetwork) {
    if (!isSolanaNetwork(network)) {
      throw new TypeError(
        `Unknown Solana network: ${JSON.stringify(network)} — expected one of mainnet-beta, devnet, testnet, localnet`
      );
    }
    this.#network = network;
    this.chain = solanaChain(network);
  }

  /** The named network this adapter is bound to. */
  get network(): SolanaNetwork {
    return this.#network;
  }

  /**
   * Derives the entity's payment wallet on this chain from `opts.seed`.
   *
   * The seed is consumed per call (a throwaway tree is built, derived
   * from and disposed in `finally`); the returned
   * {@link WalletDescriptor} carries NO key material — the derived
   * private key is wiped before returning. Use {@link SolanaWalletTree}
   * directly when you need the raw signing key.
   *
   * @param entity - The attested entity the wallet is resolved for;
   *   its canonical name becomes the descriptor `label` (diagnostics).
   * @param opts - `seed` (REQUIRED, exactly 64 bytes) and `index`
   *   (default `0`).
   * @throws {TypeError} if `opts.seed` is missing, or not a 64-byte
   *   `Uint8Array`, or `index` is not a safe integer in `0..2^31 − 1`.
   */
  async resolveWallet(
    entity: WalletEntityRef,
    opts?: { seed?: Uint8Array; index?: number }
  ): Promise<WalletDescriptor> {
    if (opts?.seed === undefined) {
      throw new TypeError(
        'Solana resolveWallet requires opts.seed — the adapter is deterministic and derives from the 64-byte seed'
      );
    }
    const tree = SolanaWalletTree.fromSeed(opts.seed);
    try {
      const wallet = await tree.deriveWallet(opts.index ?? 0);
      const descriptor: WalletDescriptor = {
        chain: this.chain,
        address: wallet.address,
        derivationPath: wallet.derivationPath,
        label: entity.name,
      };
      secureWipe(wallet.privateKey); // descriptors never carry key material
      return descriptor;
    } finally {
      tree.dispose();
    }
  }

  /** Structural base58/32-byte check — {@link isValidSolanaAddress}. */
  isValidAddress(address: string): boolean {
    return isValidSolanaAddress(address);
  }

  /**
   * Index allocation over used `m/44'/501'/N'/0'` paths
   * (v1.2 §2.2): foreign/unparseable paths are ignored, empty (or
   * empty-after-filtering) input yields `0`, otherwise `max+1` —
   * holes are never reused.
   *
   * @throws {TypeError} if `usedPaths` is not an array.
   */
  nextIndex(usedPaths: string[]): number {
    return nextPaymentIndex(usedPaths);
  }
}
