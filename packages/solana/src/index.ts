// packages/solana/src/index.ts
//
// @me2em/solana — the Solana track of the Me2eM payment layer
// (Документ 2 v1.2 §9, Ф3 "wallet-only"): deterministic wallet
// trees over `crypto.slip10`, chain-bound wallet adapters, payment
// references and Solana Pay request URLs.
//
// Scope boundary: this release is OFFLINE — no RPC, no
// transaction building, no signing backend. `verifyPayment` /
// `verifyWalletBinding` override arrive with Ф4 (rc.2), `pay` with
// Ф5 (rc.3). The package imports no curve library: derivation is
// delegated to `@me2em/crypto`'s SLIP-0010 namespace.

export {
  SOLANA_CHAINS,
  SOLANA_NAMESPACE,
  isSolanaChain,
  isSolanaNetwork,
  solanaChain,
  type SolanaNetwork,
} from './networks.js';
export { SolanaWalletTree, nextPaymentIndex, type SolanaDerivedWallet } from './wallet-tree.js';
export { SolanaWalletAdapter, isValidSolanaAddress } from './adapter.js';
export { createPaymentReference } from './reference.js';
export { createPaymentRequestURL, SOLANA_NATIVE_ASSET } from './url.js';
export { registerSolanaAdapters, type RegisterSolanaAdaptersOptions } from './register.js';
