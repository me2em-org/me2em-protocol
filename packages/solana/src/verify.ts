// packages/solana/src/verify.ts
//
// SolanaPaymentAdapter (Ф4) — the @me2em/core `PaymentAdapter`
// implementation for Solana.
//
// Implements the full `PaymentAdapter` interface:
// - Wallet resolution delegates to `SolanaWalletAdapter` (unchanged).
// - `verifyPayment` — normative check order (v1.2 §5.4).
// - `verifyWalletBinding` — on-curve override.
// - `pay` — throws `NOT_IMPLEMENTED` (Ф5).
//
// No payment submission in Ф4 — `pay` is Ф5 (`@solana/kit`).

import type {
  PaymentAdapter,
  PaymentRequest,
  PaymentResult,
  WalletDescriptor,
  WalletEntityRef,
} from '@me2em/core';
import { base58 } from '@scure/base';
import { SolanaWalletAdapter } from './adapter.js';
import type { SolanaNetwork } from './networks.js';
import { SOLANA_RPC_ENDPOINTS, solanaChain } from './networks.js';
import {
  RpcClient,
  type ParsedTransactionResponse,
  type SignatureInfo,
} from './rpc.js';
import { parseLutAddresses } from './lut.js';
import { verifyWalletBindingSolana } from './wallet-binding.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for `SolanaPaymentAdapter`.
 */
export interface SolanaPaymentAdapterOptions {
  /** Named Solana network — whitelist (see networks.ts). */
  readonly network: SolanaNetwork;
  /**
   * RPC endpoint override. Default: the network's public RPC from
   * `SOLANA_RPC_ENDPOINTS`. Production: pass your own RPC.
   */
  readonly endpoint?: string;
  /**
   * JSON-RPC fetch implementation (for tests / custom transports).
   * Default: `globalThis.fetch`.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Parsed transaction with instructions (extends the base
 * ParsedTransactionResponse with the instructions field we consume).
 */
interface ParsedTransactionWithInstructions extends ParsedTransactionResponse {
  transaction: {
    message: {
      accountKeys: readonly {
        readonly pubkey: string;
        readonly signer: boolean;
        readonly writable: boolean;
        readonly source: string;
      }[];
      readonly addressTableLookups?: readonly {
        readonly accountKey: string;
        readonly readonlyIndexes: readonly number[];
        readonly writableIndexes: readonly number[];
      }[];
      readonly instructions?: readonly {
        readonly program?: string;
        readonly parsed?: {
          readonly type?: string;
          readonly info?: Record<string, unknown>;
        };
      }[];
    };
    readonly signatures: readonly string[];
  };
  readonly meta?: {
    readonly loadedAddresses?: {
      readonly writable: readonly string[];
      readonly readonly: readonly string[];
    };
    readonly blockTime?: number | null;
  };
  readonly blockTime?: number | null;
  readonly version?: number | string;
}

// ---------------------------------------------------------------------------
// SolanaPaymentAdapter
// ---------------------------------------------------------------------------

/**
 * Solana payment adapter (Ф4): read-only verification of confirmed
 * transactions and on-curve wallet-binding. `pay` is NOT part of Ф4 —
 * it throws `NOT_IMPLEMENTED` until Ф5.
 *
 * Implements core's `PaymentAdapter`. The wallet-resolution surface
 * (`resolveWallet`, `isValidAddress`, `nextIndex`) is delegated to
 * `SolanaWalletAdapter` — this adapter adds `verifyPayment` and
 * `verifyWalletBinding`.
 */
export class SolanaPaymentAdapter implements PaymentAdapter {
  readonly #wallet: SolanaWalletAdapter;
  readonly #verify: SolanaPaymentVerifier;

  constructor(opts: SolanaPaymentAdapterOptions) {
    this.#wallet = new SolanaWalletAdapter(opts.network);
    this.#verify = new SolanaPaymentVerifier(opts);
  }

  /** Exact CAIP-2 chain id — also this adapter's registry key. */
  get chain(): string {
    return this.#wallet.chain;
  }

  /** The named network this adapter is bound to. */
  get network(): SolanaNetwork {
    return this.#wallet.network;
  }

  /** Delegate to `SolanaWalletAdapter.resolveWallet`. */
  async resolveWallet(
    entity: WalletEntityRef,
    opts?: { seed?: Uint8Array; index?: number }
  ): Promise<WalletDescriptor> {
    return this.#wallet.resolveWallet(entity, opts);
  }

  /** Delegate to `SolanaWalletAdapter.isValidAddress`. */
  isValidAddress(address: string): boolean {
    return this.#wallet.isValidAddress(address);
  }

  /** Delegate to `SolanaWalletAdapter.nextIndex`. */
  nextIndex(usedPaths: string[]): number {
    return this.#wallet.nextIndex(usedPaths);
  }

  /**
   * Verify a confirmed transaction against a `PaymentRequest`.
   * Delegates to `SolanaPaymentVerifier.verifyPayment` (normative
   * order: v1.2 §5.4).
   */
  async verifyPayment(
    txRef: string,
    request: PaymentRequest
  ): Promise<PaymentResult> {
    return this.#verify.verifyPayment(txRef, request);
  }

  /**
   * On-curve wallet-binding override (Ф4).
   *
   * This is the ADAPTER OVERRIDE — it does NOT replace core-default
   * `verifyWalletBinding` (signature + subject + address equality).
   * The application calls BOTH:
   *
   *   1. core-default: `verifyWalletBinding(wallet, entity, attestation, { issuerPublicKey })`
   *   2. this: `verifyWalletBindingSolana(wallet)`
   *
   * Both must return `true` for a complete binding (v1.2 §6).
   */
  async verifyWalletBinding(
    wallet: WalletDescriptor,
    _entity: WalletEntityRef,
    _attestation: unknown
  ): Promise<boolean> {
    return verifyWalletBindingSolana(wallet);
  }

  /**
   * `pay` is NOT part of Ф4. Throws `NOT_IMPLEMENTED` until Ф5
   * (payment submission via `@solana/kit`).
   */
  async pay(_from: WalletDescriptor, _request: PaymentRequest): Promise<string> {
    throw new Error(
      'SolanaPaymentAdapter.pay is NOT_IMPLEMENTED in rc.3 — Ф5 (payment submission) is a separate track'
    );
  }
}

// ---------------------------------------------------------------------------
// SolanaPaymentVerifier — the verification engine
// ---------------------------------------------------------------------------

/**
 * Internal: the Solana-specific verification engine for
 * `verifyPayment`. Encapsulates RPC access, LUT caching, and all
 * normative check steps (v1.2 §5.4).
 */
class SolanaPaymentVerifier {
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #chain: string;
  readonly #rpc: RpcClient;
  readonly #lutCache = new Map<string, readonly Uint8Array[]>();

  constructor(opts: SolanaPaymentAdapterOptions) {
    this.#endpoint =
      opts.endpoint ?? (SOLANA_RPC_ENDPOINTS[opts.network] as string);
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#chain = solanaChain(opts.network);
    this.#rpc = new RpcClient({
      endpoint: this.#endpoint,
      fetch: this.#fetch,
    });
  }

  /**
   * Normative payment verification (v1.2 §5.4):
   *
   * 1. NOT_FOUND — transaction not found
   * 2. REFERENCE_MISMATCH — reference not in static keys OR LUT
   * 3. EXPIRED — payment time > request.expiresAt
   * 4. REPLAYED — >1 confirmed transaction with same reference
   * 5. WRONG_RECIPIENT — no system.transfer to request.payTo
   * 6. UNDERPAID — sum of lamports < amount_lamports
   * 7. success
   */
  async verifyPayment(
    txRef: string,
    request: PaymentRequest
  ): Promise<PaymentResult> {
    const now = Math.floor(Date.now() / 1000);

    // В-7: chain check (caller must not pass a request for a different chain)
    if (request.chain !== this.#chain) {
      throw new TypeError(
        `verifyPayment: request.chain (${request.chain}) does not match adapter chain (${this.#chain})`
      );
    }

    // Step 1: NOT_FOUND
    const tx = await this.#getTransaction(txRef);
    if (tx === null) {
      return { status: 'failure', reason: 'NOT_FOUND', observedAt: now };
    }

    // Step 2: REFERENCE_MISMATCH (containment: static + LUT)
    if (!(await this.#containsReference(tx, request.reference))) {
      return { status: 'failure', reason: 'REFERENCE_MISMATCH', observedAt: now };
    }

    // Step 3: EXPIRED (blockTime → observedAt fallback)
    // Containment (step 2) runs BEFORE time — otherwise a foreign txRef
    // with an expired blockTime would falsely return EXPIRED.
    const paymentTime = tx.meta?.blockTime ?? now;
    if (paymentTime > request.expiresAt) {
      return { status: 'failure', reason: 'EXPIRED', observedAt: now };
    }

    // Step 4: REPLAYED (chain-level — >1 confirmed with reference)
    const signatures = await this.#getSignaturesForAddress(request.reference);
    const confirmedWithReference = signatures.filter(
      (s) =>
        s.confirmationStatus === 'confirmed' ||
        s.confirmationStatus === 'finalized'
    );
    if (confirmedWithReference.length > 1) {
      return { status: 'failure', reason: 'REPLAYED', observedAt: now };
    }

    // Step 5: WRONG_RECIPIENT
    if (!this.#verifyRecipient(tx, request.payTo)) {
      return { status: 'failure', reason: 'WRONG_RECIPIENT', observedAt: now };
    }

    // Step 6a: WRONG_ASSET (Ф4 SOL-only)
    if (request.asset !== 'sol') {
      return { status: 'failure', reason: 'WRONG_ASSET', observedAt: now };
    }

    // Step 6: UNDERPAID
    if (!this.#verifyAmount(tx, request.amount, request.payTo)) {
      return { status: 'failure', reason: 'UNDERPAID', observedAt: now };
    }

    // Step 7: success
    return { status: 'success', observedAt: now };
  }

  // -----------------------------------------------------------------------
  // Step 1: NOT_FOUND
  // -----------------------------------------------------------------------

  async #getTransaction(
    signature: string
  ): Promise<ParsedTransactionWithInstructions | null> {
    const result = await this.#rpc.getTransaction(signature);
    if (result === null) return null;
    return result as ParsedTransactionWithInstructions;
  }

  // -----------------------------------------------------------------------
  // Step 2: REFERENCE_MISMATCH (containment)
  // -----------------------------------------------------------------------

  /**
   * Check if `reference` (base58 pubkey) is contained in the
   * transaction's static account keys OR LUT-resolved addresses.
   *
   * Priority: `meta.loadedAddresses` first (RPC-resolved), then
   * manual bincode fallback (if `addressTableLookups` exist but
   * `loadedAddresses` is absent).
   */
  async #containsReference(
    tx: ParsedTransactionWithInstructions,
    reference: string
  ): Promise<boolean> {
    // Static keys: tx.transaction.message.accountKeys[].pubkey
    const staticKeys = tx.transaction.message.accountKeys.map(
      (k) => k.pubkey
    );
    if (staticKeys.includes(reference)) return true;

    // LUT via meta.loadedAddresses (RPC-resolved, jsonParsed)
    const loaded = tx.meta?.loadedAddresses;
    if (loaded) {
      const allLut = [...loaded.writable, ...loaded.readonly];
      if (allLut.includes(reference)) return true;
    }

    // Manual LUT fallback: if addressTableLookups exist but loadedAddresses
    // is absent (old RPC / legacy tx), parse LUTs manually.
    const tableLookups = tx.transaction.message.addressTableLookups;
    if (tableLookups && !loaded) {
      for (const lookup of tableLookups) {
        const lutAddrs = await this.#resolveLutLookup(lookup.accountKey);
        if (lutAddrs) {
          for (const addrBytes of lutAddrs) {
            const addr = base58.encode(addrBytes);
            if (addr === reference) return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Resolve a single LUT lookup: fetch account data, parse, cache.
   */
  async #resolveLutLookup(
    lookupKey: string
  ): Promise<readonly Uint8Array[] | null> {
    // Check cache first
    const cached = this.#lutCache.get(lookupKey);
    if (cached !== undefined) return cached;

    // Fetch from RPC
    const account = await this.#rpc.getAccountInfo(lookupKey);
    if (account === null) {
      this.#lutCache.set(lookupKey, []); // miss — cache it
      return null;
    }

    const [base64Data] = account.data;
    const addresses = parseLutAddresses(base64Data);
    // Cache the result (null if parse failed — fail-closed at call site)
    this.#lutCache.set(lookupKey, addresses ?? []);
    return addresses;
  }

  // -----------------------------------------------------------------------
  // Step 5: WRONG_RECIPIENT
  // -----------------------------------------------------------------------

  /**
   * Check that at least one `system.transfer` instruction in the
   * transaction sends to `payTo`.
   *
   * SPL (`spl-token` / `spl-token-2022`) is NOT supported in Ф4 —
   * `asset !== 'sol'` → `WRONG_ASSET` (checked as step 6a before
   * #verifyAmount).
   */
  #verifyRecipient(tx: ParsedTransactionWithInstructions, payTo: string): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedInstructions = (tx.transaction.message as any).instructions;
    if (!Array.isArray(parsedInstructions)) return false;

    for (const ix of parsedInstructions) {
      if (
        ix.program === 'system' &&
        ix.parsed?.type === 'transfer' &&
        ix.parsed?.info?.destination === payTo
      ) {
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Step 6: UNDERPAID
  // -----------------------------------------------------------------------

  /**
   * Check that the total lamports sent via `system.transfer` to
   * `payTo` meets or exceeds `amount` (whole units → lamports).
   *
   * Ф4 is SOL-only: `amount * 1e9` = lamports.
   * SPL check is done as step 6a (WRONG_ASSET) before this method.
   */
  #verifyAmount(
    tx: ParsedTransactionWithInstructions,
    amount: string,
    payTo: string
  ): boolean {
    const amountLamports = BigInt(Math.round(parseFloat(amount) * 1e9));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedInstructions = (tx.transaction.message as any).instructions;
    if (!Array.isArray(parsedInstructions)) return false;

    let sum = BigInt(0);
    for (const ix of parsedInstructions) {
      if (
        ix.program === 'system' &&
        ix.parsed?.type === 'transfer' &&
        ix.parsed?.info?.destination === payTo
      ) {
        const lamports = ix.parsed?.info?.lamports;
        if (typeof lamports === 'number' || typeof lamports === 'bigint') {
          sum += BigInt(lamports);
        }
      }
    }

    return sum >= amountLamports;
  }

  // -----------------------------------------------------------------------
  // Step 4: REPLAYED helper
  // -----------------------------------------------------------------------

  async #getSignaturesForAddress(address: string): Promise<SignatureInfo[]> {
    return this.#rpc.getSignaturesForAddress(address, { limit: 100 });
  }
}
