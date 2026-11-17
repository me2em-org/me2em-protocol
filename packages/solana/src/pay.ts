// packages/solana/src/pay.ts
//
// Solana `pay` (Ф5): programmatic spend from a managed wallet.
// Seed per call — the adapter stays stateless (В-1/E): the 64-byte
// seed arrives with the call, a throwaway `SolanaWalletTree` derives
// the source wallet, signs, and is disposed in `finally`. Nothing —
// seed, node key, tree — is retained after the call returns.
//
// SOL-only (В-3/A): `request.asset` must be the chain-native asset
// (`SOLANA_NATIVE_ASSET`); SPL transfer-checked → deferred (amendment
// to P0.3 §7).
//
// Transport (В-7/A): the caller supplies an `RpcClient` (`PayContext`)
// — the same minimal JSON-RPC client Ф4 uses — plus the exact CAIP-2
// chain it serves. `pay` fetches a fresh blockhash per call and
// submits with `sendTransaction`; it does NOT wait for confirmation —
// checking execution is `verifyPayment`'s job (v1.2 §5.3).
//
// Error contract: contract violations throw bare `TypeError` (the
// package-wide programmer-error form); transport failures propagate
// the `RpcClient`'s bare `Error`. On success the transaction signature
// is returned (non-empty).

import type { PaymentRequest, WalletDescriptor } from '@me2em/core';
import { secureWipe } from '@me2em/crypto';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  createSignerFromKeyPair,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { createKeyPairFromPrivateKeyBytes } from '@solana/keys';
import { getTransferSolInstruction } from '@solana-program/system';
import { getAddMemoInstruction } from '@solana-program/memo';
import { RpcClient } from './rpc.js';
import { isValidSolanaAddress } from './adapter.js';
import { SOLANA_NATIVE_ASSET } from './url.js';
import { SolanaWalletTree } from './wallet-tree.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-call spend options (В-1/E). */
export interface PayOptions {
  /** The 64-byte master seed — consumed per call, never retained. */
  readonly seed: Uint8Array;
  /** Optional on-chain memo text (SPL memo program instruction). */
  readonly memo?: string;
}

/** Transport context: the caller guarantees `rpc` serves `chain`. */
export interface PayContext {
  /** JSON-RPC transport — typically `SolanaPaymentVerifier.rpc`. */
  readonly rpc: RpcClient;
  /** Exact CAIP-2 chain id the RPC serves (e.g. `solana:devnet`). */
  readonly chain: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The Me2eM Solana payment path (v1.2 §2.2) — kept in sync with
 * `PAYMENT_PATH_RE` in wallet-tree.ts (module-private there; `pay`
 * parses an already-produced descriptor path back into its index).
 */
const PAYMENT_PATH_RE = /^m\/44'\/501'\/(0|[1-9][0-9]*)'(?:\/0')?$/;

/** Index ceiling from wallet-tree.ts (SLIP-0010 account range). */
const MAX_PAYMENT_INDEX = 0x7fffffff;

/**
 * Parses the payment index out of a descriptor's derivation path.
 * No default: a missing or foreign path must not silently sign with
 * wallet `0` — `pay` only spends from the exact wallet the descriptor
 * names.
 */
function parsePaymentIndex(path: string | undefined): number {
  if (typeof path !== 'string') {
    throw new TypeError(
      'pay: from.derivationPath is required — pay derives the source wallet from the descriptor, no default index exists'
    );
  }
  const match = PAYMENT_PATH_RE.exec(path);
  if (match === null) {
    throw new TypeError(
      `pay: from.derivationPath is not a Me2eM Solana payment path: ${JSON.stringify(path)}`
    );
  }
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_PAYMENT_INDEX) {
    throw new TypeError(`pay: derivation path index out of range: ${path}`);
  }
  return index;
}

const SOL_AMOUNT_RE = /^\d+(\.\d{1,9})?$/;

/**
 * Converts a decimal SOL amount string to lamports (bigint), exactly —
 * never through float (BL-55). Strict grammar: ASCII digits only, at
 * most one dot, ≤ 9 fractional digits; zero is rejected (a 0-lamport
 * transfer is a no-op that still burns fee).
 */
export function solToLamports(amount: string): bigint {
  if (typeof amount !== 'string' || !SOL_AMOUNT_RE.test(amount)) {
    throw new TypeError(
      `pay: amount must be a non-negative decimal string in whole SOL units with ≤9 fractional digits, got ${JSON.stringify(amount)}`
    );
  }
  const [whole, frac = ''] = amount.split('.');
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(frac.padEnd(9, '0'));
  if (lamports === 0n) {
    throw new TypeError(
      `pay: amount must be greater than zero, got ${JSON.stringify(amount)}`
    );
  }
  return lamports;
}

// ---------------------------------------------------------------------------
// pay
// ---------------------------------------------------------------------------

/**
 * Builds, signs and submits the SOL payment for `request` from the
 * wallet controlled by `opts.seed`, and returns the transaction
 * signature (`txRef`).
 *
 * Validation order: chain (`request.chain`/`from.chain` vs `ctx.chain`)
 * → asset (SOL-only) → seed shape → recipient/reference structure →
 * derivation path → derived-address agreement (`derived.address ===
 * from.address` — fail-closed against a descriptor/seed mismatch).
 *
 * The transaction: system transfer (`source` = the derived wallet,
 * signer + fee payer; `destination` = `request.payTo`) with
 * `request.reference` appended as a read-only, non-signing account key
 * (the Solana Pay convention — the system program ignores extra keys,
 * `verifyPayment` sees them in the account keys), plus an optional
 * memo instruction. Lifetime: a fresh `getLatestBlockhash` per call;
 * submission: `sendTransaction` (base64 wire, preflight simulation
 * on) — no confirmation wait (v1.2 §5.3).
 *
 * The seed and the derived node key are wiped in `finally`; the
 * throwaway tree is disposed. On failure `pay` throws — never returns
 * an empty `txRef`.
 */
export async function pay(
  from: WalletDescriptor,
  request: PaymentRequest,
  opts: PayOptions,
  ctx: PayContext
): Promise<string> {
  // Chain: both the request and the source wallet must live on the
  // exact chain the transport serves.
  if (request.chain !== ctx.chain) {
    throw new TypeError(
      `pay: request.chain (${request.chain}) does not match transport chain (${ctx.chain})`
    );
  }
  if (from.chain !== ctx.chain) {
    throw new TypeError(
      `pay: from.chain (${from.chain}) does not match transport chain (${ctx.chain})`
    );
  }
  // Asset: SOL-only in rc.4 (В-3/A) — symmetric with Ф4 step 6a.
  if (request.asset !== SOLANA_NATIVE_ASSET) {
    throw new TypeError(
      `pay: request.asset (${JSON.stringify(request.asset)}) is not supported — only the chain-native asset ${JSON.stringify(SOLANA_NATIVE_ASSET)} (SPL transfer-checked is deferred)`
    );
  }
  // Seed shape (the resolveWallet contract).
  if (!(opts.seed instanceof Uint8Array) || opts.seed.length !== 64) {
    throw new TypeError(
      'pay: opts.seed must be a 64-byte Uint8Array (the resolveWallet seed contract)'
    );
  }
  // Recipient / reference: structural base58-32 checks (references are
  // arbitrary 32-byte keys — never on-curve filtered).
  if (!isValidSolanaAddress(request.payTo)) {
    throw new TypeError('pay: request.payTo is not a valid Solana address');
  }
  if (!isValidSolanaAddress(request.reference)) {
    throw new TypeError(
      'pay: request.reference must be a base58-encoded 32-byte reference key'
    );
  }
  const lamports = solToLamports(request.amount);
  const index = parsePaymentIndex(from.derivationPath);

  // Derive → agree → sign → submit; wipe and dispose whatever happens.
  const tree = SolanaWalletTree.fromSeed(opts.seed);
  let nodeKey: Uint8Array | undefined;
  try {
    const wallet = await tree.deriveWallet(index);
    nodeKey = wallet.privateKey;
    if (wallet.address !== from.address) {
      throw new TypeError(
        `pay: derived address (${wallet.address}) does not match from.address (${from.address}) — descriptor and seed disagree`
      );
    }

    const keyPair = await createKeyPairFromPrivateKeyBytes(nodeKey);
    const sourceSigner = await createSignerFromKeyPair(keyPair);

    const transfer = getTransferSolInstruction({
      source: sourceSigner,
      destination: request.payTo as Address,
      amount: lamports,
    });
    // Reference rides the transfer instruction as a read-only,
    // non-signing account key (reference.ts contract).
    const referenceMeta: AccountMeta = {
      address: request.reference as Address,
      role: AccountRole.READONLY,
    };
    const instructions: Instruction[] = [
      {
        ...transfer,
        accounts: [...transfer.accounts, referenceMeta],
      },
    ];
    if (opts.memo !== undefined) {
      instructions.push(getAddMemoInstruction({ memo: opts.memo }));
    }

    const blockhash = await ctx.rpc.getLatestBlockhash();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(sourceSigner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash.blockhash as Blockhash,
            // RPC returns a JSON number; the lifetime field is u64.
            lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight),
          },
          m
        ),
      (m) => appendTransactionMessageInstructions(instructions, m)
    );
    const signedTransaction = await signTransactionMessageWithSigners(message);
    const wire = getBase64EncodedWireTransaction(signedTransaction);

    const txRef = await ctx.rpc.sendTransaction(wire);
    if (typeof txRef !== 'string' || txRef.length === 0) {
      throw new Error('pay: empty signature from sendTransaction');
    }
    return txRef;
  } finally {
    if (nodeKey !== undefined) secureWipe(nodeKey);
    tree.dispose();
  }
}
