// packages/solana/src/index.ts
//
// @me2em/solana — the Solana track of the Me2eM payment layer
// (Документ 2 v1.2 §9, Ф3 "wallet-only" → Ф4 "verify"): deterministic
// wallet trees over `crypto.slip10`, chain-bound wallet adapters,
// payment references and Solana Pay request URLs.
//
// Scope boundary: this release is OFFLINE — no transaction building,
// no signing backend. `pay` is Ф5 (`@solana/kit`). Ф4 adds
// `verifyPayment`, `verifyWalletBinding` (on-curve override), and
// `deriveForVerification` (Mode 1 helper).

export {
  SOLANA_CHAINS,
  SOLANA_NAMESPACE,
  SOLANA_RPC_ENDPOINTS,
  isSolanaChain,
  isSolanaNetwork,
  solanaChain,
  type SolanaNetwork,
} from './networks.js';
export { SolanaWalletTree, nextPaymentIndex, type SolanaDerivedWallet } from './wallet-tree.js';
export { SolanaWalletAdapter, isValidSolanaAddress } from './adapter.js';
export { SolanaPaymentAdapter, type SolanaPaymentAdapterOptions } from './verify.js';
export { verifyWalletBindingSolana } from './wallet-binding.js';
export { createPaymentReference } from './reference.js';
export { createPaymentRequestURL, SOLANA_NATIVE_ASSET } from './url.js';
export { registerSolanaAdapters, type RegisterSolanaAdaptersOptions } from './register.js';
export { RpcClient, type RpcClientOptions, type ParsedTransactionResponse, type SignatureInfo, type LutAddresses } from './rpc.js';
export { parseLutAddresses } from './lut.js';
