// packages/solana/src/networks.ts
//
// Chain identity constants for the Solana adapter (Документ 2 v1.2
// §0.3): the CAIP-2 GRAMMAR lives in @me2em/core, the concrete Solana
// VALUES live here. Every key is an exact CAIP-2 chain id — the same
// form the core adapter registry uses as its key and the same form
// attestation payloads carry in `subjectWalletChain`.

import { parseChain } from '@me2em/core';

/**
 * The Solana networks @me2em/solana names. `'mainnet-beta'` is the
 * canonical Solana mainnet cluster name (not `'mainnet'`).
 */
export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

/** All known networks — the runtime whitelist for adapter construction. */
const NETWORKS: readonly SolanaNetwork[] = ['mainnet-beta', 'devnet', 'testnet', 'localnet'];

/**
 * Exact CAIP-2 chain id per network. These are the REGISTRY KEYS the
 * adapters register under — `solana:mainnet-beta` and `solana:devnet`
 * are different keys with no aliasing (v1.2 §2.1).
 */
export const SOLANA_CHAINS: Readonly<Record<SolanaNetwork, string>> = {
  'mainnet-beta': 'solana:mainnet-beta',
  devnet: 'solana:devnet',
  testnet: 'solana:testnet',
  localnet: 'solana:localnet',
};

/** The CAIP-2 namespace this package owns. */
export const SOLANA_NAMESPACE = 'solana';

/** The exact CAIP-2 chain id of a Solana network. */
export function solanaChain(network: SolanaNetwork): string {
  return SOLANA_CHAINS[network];
}

/**
 * True when `chain` is a grammatically valid CAIP-2 id in the `solana`
 * namespace (any reference). Used to gate payment-request URLs and to
 * filter derivation paths per chain (v1.2 §2.2 — index spaces are
 * chain-scoped, the caller filters by `subjectWalletChain` first).
 */
export function isSolanaChain(chain: string): boolean {
  const parsed = parseChain(chain);
  return parsed !== null && parsed.namespace === SOLANA_NAMESPACE;
}

/** Runtime type guard for {@link SolanaNetwork} (exact string match). */
export function isSolanaNetwork(value: string): value is SolanaNetwork {
  return (NETWORKS as readonly string[]).includes(value);
}
