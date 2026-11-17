// packages/solana/src/x402-signer.ts
//
// SolanaX402Signer (ТЗ @me2em/x402 v1.2 §4) — the key-owner side of
// the x402 `PaymentSigner` contract for Solana native SOL (M2).
//
// Offline by construction: no RPC lives here. The recent blockhash is
// an INJECTION (`getRecentBlockhash`, the same philosophy as the B402
// auth injection §3.5) — the application owns its RPC, cluster and
// freshness policy; the signer only validates, serializes, signs and
// wipes. Missing injection is a constructor `TypeError` (fail-fast).
//
// The legacy-transfer wire format is serialized BY HAND — compact-u16
// (shortvec) lengths, the canonical system-program transfer layout —
// and `@solana/kit` is deliberately NOT used on this path (ТЗ §4.2):
// zero extra dependencies on the import path, deterministic bytes,
// golden-vector-testable. The signature is Ed25519 over the message
// bytes (`signRaw` from @me2em/crypto); `verifyRaw` re-derives it
// offline.
//
// `@me2em/x402` is imported TYPE-ONLY (zero runtime code — the
// sanctioned §0.3 exception): the class implements the interface, it
// does not run the transport. `createPaymentFetch` composes with this
// class on the application side (see README).

import type { PaymentSigner, SignerCapability } from '@me2em/x402';
import type { X402PaymentRequirements, X402ResourceInfo } from '@me2em/core';
import { base58 } from '@scure/base';
import { secureWipe, signRaw, toBase64 } from '@me2em/crypto';
import { SolanaWalletTree } from './wallet-tree.js';
import { isValidSolanaAddress } from './adapter.js';
import { SOLANA_NATIVE_ASSET } from './url.js';
import { SOLANA_CHAINS } from './networks.js';

/**
 * ⚠️ **@experimental payload convention** (ТЗ §4.4, §8.7): the exact
 * scheme payload is a me2em convention until the Solana-facilitator
 * contract arrives (§8.7 — payload format and blockhash source are
 * open). The `kind` tag versions it; final fixation happens with that
 * contract, and a change here is a Breaking note in the CHANGELOG.
 *
 * `transaction` is the signed legacy Solana transaction in the wire
 * format (`compact-u16(1) || signature || message`) encoded as
 * standard base64 — the same encoding Solana RPC `sendTransaction`
 * accepts, so a facilitator can settle it without re-serialization.
 *
 * A type alias (not an interface) — so the payload remains directly
 * assignable to the `Record<string, unknown>` return contract of
 * `PaymentSigner.signPayment`.
 */
export type SolanaX402Payload = {
  /** Convention tag — versions the experimental payload shape. */
  readonly kind: 'solana-legacy-transfer';
  /** Exact CAIP-2 chain id, echoed from `requirements.network`. */
  readonly network: string;
  /** Signed legacy transaction wire bytes, standard base64. */
  readonly transaction: string;
  /** The recent blockhash used (base58, echoed from the injection). */
  readonly blockhash: string;
  /** Signer address (base58 of the Ed25519 public key). */
  readonly from: string;
  /** Recipient address (base58, echoed from `requirements.payTo`). */
  readonly to: string;
  /** Atomic amount (lamports) as a canonical decimal string. */
  readonly lamports: string;
}

/** Options for {@link SolanaX402Signer}. */
export interface SolanaX402SignerOptions {
  /** The deterministic wallet tree the payment wallet derives from. */
  readonly tree: SolanaWalletTree;
  /** Derivation index into `tree` — default `0`. Allocate fresh
   *  indices with `nextPaymentIndex(usedPaths)` (chain-scoped). */
  readonly index?: number;
  /**
   * Source of the recent blockhash (base58), injected per
   * `signPayment` call — the application's RPC owns freshness.
   * Required: there is no RPC inside the signer (ТЗ §4.4).
   */
  readonly getRecentBlockhash: () => Promise<string>;
}

/**
 * The largest plain (pre-hardening) derivation index — mirrors the
 * range check of `SolanaWalletTree.deriveWallet` (fail-fast here too,
 * before a payment attempt starts).
 */
const MAX_INDEX = 0x7fffffff;

/** Atomic-amount grammar of `X402PaymentRequirements` (core §2.1). */
const AMOUNT_RE = /^[0-9]+$/;

/** `u64` upper bound — a Solana lamports field cannot exceed it. */
const MAX_U64 = 0xffff_ffff_ffff_ffffn;

/** System program id — 32 zero bytes (base58 `1111…1`). */
const SYSTEM_PROGRAM_ID = new Uint8Array(32);

/** `SystemInstruction::Transfer` enum discriminant (u32, LE). */
const TRANSFER_DISCRIMINANT = 2;

/**
 * Compact-u16 (shortvec) length prefix, as the legacy message format
 * defines it. Every length in this layout is structurally < 128, so
 * the continuation branch is defensive correctness, not a live path.
 */
function appendCompactU16(bytes: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
}

function appendBytes(bytes: number[], data: Uint8Array): void {
  for (const b of data) bytes.push(b);
}

/**
 * Builds the legacy MESSAGE for a single system-program SOL transfer
 * (unsigned — signing happens over exactly these bytes):
 *
 * ```
 * [00]      compact-u16 header count = 1
 * [01..03]  MessageHeader: 1 required signature, 0 readonly signed,
 *           1 readonly unsigned (the trailing system program id)
 * [04]      compact-u16 account count = 3
 * [05..36]  source (fee payer + transfer source, signer, writable)
 * [37..68]  destination (writable)
 * [69..100] system program id — 32 zero bytes (readonly)
 * [101..132] recent blockhash, raw 32 bytes
 * [133]     compact-u16 instruction count = 1
 * [134]     programIdIndex = 2
 * [135]     compact-u16 account index count = 2
 * [136..137] 0 (source), 1 (destination)
 * [138]     compact-u16 data length = 12
 * [139..142] u32 LE discriminant = 2 (Transfer)
 * [143..150] u64 LE lamports
 * ```
 *
 * Total: 151 bytes for every payment — deterministic, golden-vector
 * testable (test/x402-signer.spec.ts pins full message and
 * transaction hex).
 */
function buildLegacyTransferMessage(parts: {
  readonly source: Uint8Array; // 32 bytes
  readonly destination: Uint8Array; // 32 bytes
  readonly blockhash: Uint8Array; // 32 bytes
  readonly lamports: bigint;
}): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, TRANSFER_DISCRIMINANT, true);
  view.setBigUint64(4, parts.lamports, true);

  const bytes: number[] = [];
  appendCompactU16(bytes, 1); // header array length
  bytes.push(1, 0, 1); // MessageHeader [requiredSigs, readonlySigned, readonlyUnsigned]
  appendCompactU16(bytes, 3); // account keys
  appendBytes(bytes, parts.source);
  appendBytes(bytes, parts.destination);
  appendBytes(bytes, SYSTEM_PROGRAM_ID);
  appendBytes(bytes, parts.blockhash); // raw 32 bytes, not length-prefixed
  appendCompactU16(bytes, 1); // instruction count
  bytes.push(2); // programIdIndex — system program is the 3rd key
  appendCompactU16(bytes, 2); // account indexes
  bytes.push(0, 1); // source, destination
  appendCompactU16(bytes, data.length);
  appendBytes(bytes, data);
  return Uint8Array.from(bytes);
}

/**
 * The x402 `PaymentSigner` for Solana (ТЗ §4): signs one
 * `exact`/native-SOL requirement into a legacy system-program
 * transfer, signed by the wallet derived from the injected
 * {@link SolanaWalletTree} at `index`.
 *
 * - **Offline**: the blockhash comes ONLY through the
 *   `getRecentBlockhash` injection — no RPC inside the signer, no
 *   network call, no transaction submission (settle is the
 *   facilitator's job, upstream §5.3.2).
 * - **Fail-closed**: an unsupported network (wildcards and
 *   `solana:localnet` are NOT in the declared set), a non-native
 *   asset (SPL is out of M2 scope, §8.3), a zero/oversized amount,
 *   an invalid or self-referencing `payTo`, or a malformed blockhash
 *   throw bare `TypeError` — the x402 client surfaces these as
 *   `SIGNER_REJECTED` with the cause attached.
 * - **Key hygiene**: `signPayment` wipes the derived private key in a
 *   `finally` block — on every path, success or throw.
 *
 * @example
 * ```ts
 * import { SolanaWalletTree, SolanaX402Signer } from '@me2em/solana';
 * import { createPaymentFetch } from '@me2em/x402';
 *
 * const tree = SolanaWalletTree.fromSeed(seed64);
 * const signer = new SolanaX402Signer({
 *   tree,
 *   index: 0,
 *   getRecentBlockhash: () => rpc.getLatestBlockhash(), // app-owned RPC
 * });
 * const payFetch = createPaymentFetch({ signer });
 * const res = await payFetch('https://api.example.com/wall');
 * ```
 */
export class SolanaX402Signer implements PaymentSigner {
  /**
   * Explicit CAIP-2 capability pairs (ТЗ §4.1): the final set is
   * subject to the facilitator contract (§8.7) — wildcards
   * (`solana:*`) are never declared, `parseChain` rejects them.
   * `localnet` is a dev convenience and deliberately not a payment
   * capability.
   */
  readonly capabilities: readonly SignerCapability[] = [
    { scheme: 'exact', network: SOLANA_CHAINS['mainnet-beta'] },
    { scheme: 'exact', network: SOLANA_CHAINS.devnet },
    { scheme: 'exact', network: SOLANA_CHAINS.testnet },
  ];

  #tree: SolanaWalletTree;
  #getRecentBlockhash: () => Promise<string>;
  #index: number;
  #networks: ReadonlySet<string>;

  /**
   * @throws {TypeError} if `opts` is not an object, `tree` is not a
   *   {@link SolanaWalletTree}, `getRecentBlockhash` is missing (the
   *   mandatory injection — ТЗ §4.4), or `index` is outside
   *   `0..2^31 − 1`.
   */
  constructor(opts: SolanaX402SignerOptions) {
    if (opts === null || typeof opts !== 'object') {
      throw new TypeError('SolanaX402Signer: opts must be an object');
    }
    if (!(opts.tree instanceof SolanaWalletTree)) {
      throw new TypeError('SolanaX402Signer: opts.tree must be a SolanaWalletTree');
    }
    if (typeof opts.getRecentBlockhash !== 'function') {
      throw new TypeError(
        'SolanaX402Signer: opts.getRecentBlockhash is required — the blockhash source is an injection, the signer performs no RPC (ТЗ §4.4)'
      );
    }
    const index = opts.index ?? 0;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > MAX_INDEX) {
      throw new TypeError(
        `SolanaX402Signer: opts.index must be a safe integer in 0..2^31 − 1, got ${String(index)}`
      );
    }
    this.#tree = opts.tree;
    this.#getRecentBlockhash = opts.getRecentBlockhash;
    this.#index = index;
    this.#networks = new Set(this.capabilities.map((cap) => cap.network));
  }

  /**
   * Signs one payment requirement (ТЗ §4.4): derives the wallet,
   * validates the requirement against the DECLARED capabilities
   * (native SOL only), builds the legacy transfer message, signs it
   * and returns the experimental payload ({@link SolanaX402Payload}).
   *
   * @param requirements - The accepted x402 payment option.
   * @param _resource - The resource descriptor; the transfer carries
   *   no memo, the x402 envelope ties the payload to the resource
   *   (the client echoes it in `PAYMENT-SIGNATURE`).
   * @returns The scheme payload; becomes `PaymentPayload.payload`.
   * @throws {TypeError} on any contract violation listed in the class
   *   docs — fail-closed, before any bytes are signed.
   * @throws {DisposedError} when the tree was disposed.
   * @throws whatever `getRecentBlockhash` throws (RPC ownership is
   *   the application's); the x402 client wraps every rejection as
   *   `SIGNER_REJECTED` with this cause.
   */
  async signPayment(
    requirements: X402PaymentRequirements,
    _resource: X402ResourceInfo
  ): Promise<Record<string, unknown>> {
    if (requirements === null || typeof requirements !== 'object') {
      throw new TypeError('SolanaX402Signer: requirements must be an object');
    }
    if (typeof requirements.network !== 'string' || !this.#networks.has(requirements.network)) {
      throw new TypeError(
        `SolanaX402Signer: network ${JSON.stringify(requirements.network)} is not covered by the declared capabilities (${[...this.#networks].join(', ')}) — no wildcard fallback (ТЗ §4.1)`
      );
    }
    if (requirements.scheme !== 'exact') {
      throw new TypeError(
        `SolanaX402Signer: scheme ${JSON.stringify(requirements.scheme)} is not supported — this signer declares 'exact' only`
      );
    }
    if (requirements.asset !== SOLANA_NATIVE_ASSET) {
      throw new TypeError(
        `SolanaX402Signer: asset ${JSON.stringify(requirements.asset)} is not supported — M2 signs native SOL (${JSON.stringify(SOLANA_NATIVE_ASSET)}) only; SPL mints follow the §8.3 facilitator contract`
      );
    }
    if (typeof requirements.amount !== 'string' || !AMOUNT_RE.test(requirements.amount)) {
      throw new TypeError(
        'SolanaX402Signer: amount must be a decimal string in atomic units (lamports)'
      );
    }
    const lamports = BigInt(requirements.amount);
    if (lamports === 0n) {
      throw new TypeError('SolanaX402Signer: amount must be > 0 — a zero transfer is not a payment');
    }
    if (lamports > MAX_U64) {
      throw new TypeError('SolanaX402Signer: amount exceeds the u64 range of a Solana transfer');
    }
    if (!isValidSolanaAddress(requirements.payTo)) {
      throw new TypeError('SolanaX402Signer: payTo is not a valid base58-32 Solana address');
    }

    const blockhash = await this.#getRecentBlockhash();
    if (typeof blockhash !== 'string') {
      throw new TypeError('SolanaX402Signer: getRecentBlockhash must return a base58 string');
    }
    let blockhashBytes: Uint8Array;
    try {
      blockhashBytes = base58.decode(blockhash);
    } catch {
      throw new TypeError('SolanaX402Signer: the injected blockhash is not valid base58');
    }
    if (blockhashBytes.length !== 32) {
      throw new TypeError(
        `SolanaX402Signer: the injected blockhash decodes to ${blockhashBytes.length} bytes, expected 32`
      );
    }

    const wallet = await this.#tree.deriveWallet(this.#index);
    try {
      if (requirements.payTo === wallet.address) {
        throw new TypeError('SolanaX402Signer: payTo equals the signer address — a self-transfer is not a payment');
      }
      const message = buildLegacyTransferMessage({
        source: base58.decode(wallet.address),
        destination: base58.decode(requirements.payTo),
        blockhash: blockhashBytes,
        lamports,
      });
      const signature = signRaw(wallet.privateKey, message);
      // Wire: compact-u16(1) || signature (64) || message.
      const tx = new Uint8Array(1 + signature.length + message.length);
      tx[0] = 1;
      tx.set(signature, 1);
      tx.set(message, 1 + signature.length);

      const payload: SolanaX402Payload = {
        kind: 'solana-legacy-transfer',
        network: requirements.network,
        transaction: toBase64(tx),
        blockhash,
        from: wallet.address,
        to: requirements.payTo,
        lamports: lamports.toString(), // canonical rendering, no leading zeros
      };
      return payload;
    } finally {
      secureWipe(wallet.privateKey); // every path — success or throw
    }
  }
}
