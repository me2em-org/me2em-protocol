// packages/solana/src/index.ts
//
// @me2em/solana — the Solana track of the Me2eM payment layer
// (Документ 2 v1.2 §9, Ф3 "wallet-only" → Ф4 "verify" → Ф5 "pay"):
// deterministic wallet trees over `crypto.slip10`, chain-bound wallet
// adapters, payment references and Solana Pay request URLs.
//
// Scope boundary: Ф4 adds `verifyPayment`, `verifyWalletBinding`
// (on-curve override) and `deriveForVerification` (Mode 1 helper).
// Ф5 adds `pay` — programmatic SOL spend from a managed wallet with
// the seed supplied PER CALL (the adapter stays stateless, В-1/E);
// SOL-only, submission without confirmation wait (В-7/A).

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
export { pay, solToLamports, type PayOptions, type PayContext } from './pay.js';
export { verifyWalletBindingSolana } from './wallet-binding.js';
export { createPaymentReference } from './reference.js';
export { createPaymentRequestURL, SOLANA_NATIVE_ASSET } from './url.js';
export { registerSolanaAdapters, type RegisterSolanaAdaptersOptions } from './register.js';
export { RpcClient, type ParsedTransactionResponse, type SignatureInfo, type LutAddresses } from './rpc.js';
export { parseLutAddresses } from './lut.js';
