// packages/solano/src/register.ts
//
// Adapter registration (Документ 2 v1.2 §2.1): one stateless adapter
// instance per exact CAIP-2 chain key — chain-bound views. Keys are
// EXACT (`solana:mainnet-beta` and `solana:devnet` are different
// registry keys; no aliasing, no prefix matching).
//
// ⚠️ Last-wins security note (v1.2 §2.1, mirrored from core): a later
// registration for an occupied chain key replaces the earlier
// adapter — registration is a privilege of the application's trusted
// code; import no untrusted dependencies before registering.

import { registerWalletAdapter } from '@me2em/core';
import { SolanaWalletAdapter } from './adapter.js';
import { isSolanaNetwork, type SolanaNetwork } from './networks.js';

/**
 * Networks registered when `registerSolanaAdapters` is called without
 * an explicit list: production-safe default — mainnet-beta only.
 * Dev/test clusters are an explicit opt-in.
 */
const DEFAULT_NETWORKS: readonly SolanaNetwork[] = ['mainnet-beta'];

export interface RegisterSolanaAdaptersOptions {
  /**
   * Networks to register (each becomes its own exact-CAIP-2 registry
   * key). Defaults to `['mainnet-beta']`. An empty array registers
   * nothing and returns a no-op disposer.
   */
  readonly networks?: readonly SolanaNetwork[];
}

/**
 * Registers Solana wallet adapters into the process-wide core
 * registry (v1.2 §2.1) — one {@link SolanaWalletAdapter} per network,
 * keyed by its exact CAIP-2 chain id.
 *
 * @param options - `{ networks?: SolanaNetwork[] }`; defaults to
 *   `['mainnet-beta']`.
 * @returns A disposer removing every registration THIS call created.
 *   Idempotent; if a later registration replaced one of these records,
 *   the disposer leaves the replacement alone (it never removes
 *   someone else's adapter).
 * @throws {TypeError} if `networks` (when provided) contains an
 *   unknown network name — validated BEFORE any registration happens,
 *   so a bad call leaves the registry untouched.
 */
export function registerSolanaAdapters(options: RegisterSolanaAdaptersOptions = {}): () => void {
  const networks = options.networks ?? DEFAULT_NETWORKS;
  for (const network of networks) {
    if (!isSolanaNetwork(network)) {
      throw new TypeError(
        `registerSolanaAdapters: unknown network ${JSON.stringify(network)} — expected one of mainnet-beta, devnet, testnet, localnet`
      );
    }
  }
  const disposers = networks.map((network) => registerWalletAdapter(new SolanaWalletAdapter(network)));
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const disposer of disposers) disposer();
  };
}
