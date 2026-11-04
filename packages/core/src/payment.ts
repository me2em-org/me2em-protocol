// payment.ts
//
// Payment-layer primitives (Документ 2 v1.2 §8): the wallet/payment
// adapter interfaces, CAIP-2 grammar helpers, the process-wide adapter
// registry and the in-memory wallet-binding storage. Pure interfaces and
// stateless helpers — no network, no chain code. Chain-specific values
// (e.g. `solana:mainnet-beta`) live in the chain packages (solana,
// monero); core pins only the grammar.
//
// Module-graph note: this module imports NOTHING from the rest of src/
// (it is a dependency leaf). `attestation.ts` reaches into it for the
// fail-closed wallet validation; the default wallet-binding check lives
// in `wallet-binding.ts` so that no runtime import cycle can form.

import type { Attestation } from './attestation.js';

/**
 * A chain wallet bound to an entity (Документ 2 v1.2 §8).
 *
 * `chain` is an exact CAIP-2 chain id (e.g. `solana:mainnet-beta`) —
 * the same grammar {@link isValidChain} checks and the same key form the
 * adapter registry uses. `address` format is defined by the chain
 * (base58 / bech32 / …).
 */
export interface WalletDescriptor {
  /** Exact CAIP-2 chain id of the wallet. */
  readonly chain: string;
  /** On-chain address in the chain's own format. */
  readonly address: string;
  /** Derivation path for deterministically derived wallets (optional). */
  readonly derivationPath?: string;
  /** Free-form label (e.g. the entity name) for diagnostics. */
  readonly label?: string;
}

/**
 * Protocol-level reference to an attested entity, used when an adapter
 * derives or resolves wallets (Документ 2 v1.2 §8). `id` is the
 * base64url-encoded 32-byte public key (the same form as attestation
 * `subjectId` / session `hId`).
 */
export interface WalletEntityRef {
  /** base64url of the entity's 32-byte Ed25519 public key. */
  readonly id: string;
  /** Which entity layer the reference points to. */
  readonly kind: 'identity' | 'handle' | 'subhandle';
  /** Canonical entity name. */
  readonly name: string;
  /** Full derivation path — present for SubHandles (`[handleName, subName]`). */
  readonly path?: string[];
}

/**
 * A chain adapter registered for exactly one CAIP-2 chain
 * (Документ 2 v1.2 §2). `core` never imports chain packages; chain
 * packages register adapters into the process-wide registry
 * ({@link registerWalletAdapter}) and the payment layer resolves them
 * by exact key ({@link getWalletAdapter}).
 */
export interface WalletAdapter {
  /** Exact CAIP-2 chain this adapter handles — also its registry key. */
  readonly chain: string;
  /**
   * Resolves (derives or attaches) the entity's wallet on this chain.
   * Deterministic adapters require `opts.seed`; without it they reject
   * with `TypeError`. Attach-only adapters ignore `seed`.
   */
  resolveWallet(
    entity: WalletEntityRef,
    opts?: { seed?: Uint8Array; index?: number }
  ): Promise<WalletDescriptor>;
  /** Structural address check (format only — no network, no on-curve). */
  isValidAddress(address: string): boolean;
  /**
   * Optional: chain-scoped index allocation from used derivation paths
   * (v1.2 §2.2). The adapter parses its own path formats; an empty input
   * — or an input that is empty after filtering to the adapter's own
   * paths — yields `0`; otherwise `max(indexes) + 1` (holes are never
   * reused); paths the adapter cannot parse are ignored, never thrown
   * on. Callers filter paths by `subjectWalletChain` before handing them
   * over. `core` performs NO fallback when the method is absent —
   * index allocation is caller responsibility.
   */
  nextIndex?(usedPaths: string[]): number;
}

/**
 * A wallet adapter that can also execute and verify payments
 * (Документ 2 v1.2 §5). Knowledge of attestations is deliberately kept
 * out of `pay`: the buyer link is `verifyWalletBinding` on the app side,
 * execution control is `verifyPayment` on the recipient side.
 */
export interface PaymentAdapter extends WalletAdapter {
  /**
   * Programmatically spends from a wallet the adapter CONTROLS
   * (derived or imported keys). `from` is non-null. External wallets
   * (browser extensions) do not go through `pay` — they follow the
   * chain-specific request-URL flow. On success `txRef` is non-empty;
   * on failure `pay` throws (v1.2 §5.1).
   */
  pay(from: WalletDescriptor, request: PaymentRequest): Promise<string>;
  /**
   * Idempotent pure read of the chain state for a confirmed transaction
   * (v1.2 §5.3): repeating the call with the same `txRef` yields the
   * same result. The normative check order and failure reasons are
   * pinned by v1.2 §5.4 (`NOT_FOUND` → `REFERENCE_MISMATCH` →
   * `EXPIRED` → `REPLAYED` → `WRONG_RECIPIENT` → `UNDERPAID` →
   * success). Chain-level `REPLAYED` is detected by the adapter;
   * order-level deduplication stays with the application.
   */
  verifyPayment(txRef: string, request: PaymentRequest): Promise<PaymentResult>;
  /**
   * Optional stronger wallet-binding verification. The core default
   * (see {@link verifyWalletBinding} in `wallet-binding.ts`) is the
   * attestation token's signature + subject agreement + address
   * equality; adapters may add chain-specific strength (e.g. on-curve
   * checks). NOT invoked implicitly by transport layers (v1.2 §6).
   */
  verifyWalletBinding?(
    wallet: WalletDescriptor,
    entity: WalletEntityRef,
    attestation: Attestation
  ): Promise<boolean>;
}

/**
 * Machine-readable reasons a payment failed verification (v1.2 §5.4).
 * `REFERENCE_MISMATCH` is the v1.2 addition: the transaction exists but
 * is not an execution of THIS request. Fail-safe rule for consumers:
 * unknown runtime values MUST be treated as `REJECTED` (never as
 * success).
 */
export type PaymentFailureReason =
  | 'NOT_FOUND' | 'UNDERPAID' | 'WRONG_RECIPIENT' | 'WRONG_ASSET'
  | 'EXPIRED' | 'REPLAYED' | 'CHAIN_UNAVAILABLE' | 'REJECTED'
  | 'REFERENCE_MISMATCH';

/**
 * A signed-off payment demand (v1.2 §0.1): every parameter a verifier
 * needs comes from this artifact — nothing is negotiated out-of-band.
 * All payment parameters live in signed data; the wire shape is pinned
 * here and unchanged from Документ 2 v1.0 (v1.2 §12).
 */
export interface PaymentRequest {
  /** Exact CAIP-2 chain the request is payable on. */
  readonly chain: string;
  /** Recipient address on that chain. */
  readonly payTo: string;
  /** Amount as a decimal string in whole token units (NOT the smallest denomination). */
  readonly amount: string;
  /** Asset identifier — the chain-native asset or a token id (e.g. SPL mint, base58). */
  readonly asset: string;
  /**
   * Correlation key included in the payment transaction (for Solana: a
   * base58-encoded 32-byte reference key). Chain-level `REPLAYED`
   * detection keys on it; order-level deduplication keys on it too.
   */
  readonly reference: string;
  /** Unix seconds — payments observed after this are `EXPIRED` (block time first, observed time as fallback). */
  readonly expiresAt: number;
}

/**
 * Outcome of {@link PaymentAdapter.verifyPayment}. `observedAt` is the
 * adapter's observation time (unix seconds) — informational, never part
 * of validation (v1.2 §5.2); `reason` is present exactly on failure.
 *
 * Provisional shape note (ТЗ-2): the final composition of the success
 * branch (e.g. extra informational fields) is reconciled with
 * Документ 2 v1.0 §3.3 when `verifyPayment` is implemented (Ф4);
 * `observedAt` and the failure `reason` are pinned by v1.2 §5.2/§5.4.
 */
export type PaymentResult =
  | { readonly status: 'success'; readonly observedAt: number }
  | {
      readonly status: 'failure';
      readonly reason: PaymentFailureReason;
      readonly observedAt: number;
    };

// ---------------------------------------------------------------------------
// CAIP-2 grammar (v1.2 §0.3) — grammar only, no chain values.
// ---------------------------------------------------------------------------

const CAIP2_NAMESPACE_RE = /^[a-z0-9-]{3,8}$/;   // [-a-z0-9]{3,8}
const CAIP2_REFERENCE_RE = /^[a-zA-Z0-9-]{1,64}$/; // [-a-zA-Z0-9]{1,64}

/**
 * Parses a CAIP-2 chain id (`namespace:reference`) per the grammar
 * pinned in v1.2 §0.3: namespace `[-a-z0-9]{3,8}`, reference
 * `[-a-zA-Z0-9]{1,64}`. Returns `null` for anything else — including
 * wrong case (`Solana:mainnet-beta`), an empty reference
 * (`solana:`), a short namespace (`s:x`) or embedded colons.
 *
 * @example
 * ```ts
 * parseChain('solana:mainnet-beta'); // { namespace: 'solana', reference: 'mainnet-beta' }
 * parseChain('solana');              // null
 * ```
 */
export function parseChain(chain: string): { namespace: string; reference: string } | null {
  if (typeof chain !== 'string') return null;
  const colon = chain.indexOf(':');
  if (colon < 0) return null;
  const namespace = chain.slice(0, colon);
  const reference = chain.slice(colon + 1);
  if (!CAIP2_NAMESPACE_RE.test(namespace)) return null;
  if (!CAIP2_REFERENCE_RE.test(reference)) return null;
  return { namespace, reference };
}

/** CAIP-2 grammar check — {@link parseChain} as a predicate. */
export function isValidChain(chain: string): boolean {
  return parseChain(chain) !== null;
}

// ---------------------------------------------------------------------------
// Adapter registry (v1.2 §2.1) — process-wide, exact-CAIP-2 keys.
// ---------------------------------------------------------------------------

const REGISTRY_SYMBOL = Symbol.for('me2em.paymentAdapters');

function getRegistry(): Map<string, WalletAdapter> {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const existing = holder[REGISTRY_SYMBOL];
  if (existing instanceof Map) return existing as Map<string, WalletAdapter>;
  // First reach in this isolate: create the shared map. globalThis +
  // Symbol.for make the registry survive duplicate module copies (even
  // different bundles) within one process; it stays per-isolate on
  // edge/serverless runtimes.
  const created = new Map<string, WalletAdapter>();
  holder[REGISTRY_SYMBOL] = created;
  return created;
}

/**
 * Registers a wallet adapter under its exact `adapter.chain` key
 * (v1.2 §2.1). Last-wins: a later registration for the same chain
 * replaces the earlier one. ⚠️ Security note: last-wins means ANY code
 * in the process can replace the adapter of a busy chain — registering
 * is a privilege of the application's trusted code; do not import
 * untrusted dependencies before registration.
 *
 * @returns A disposer removing the record this call created. The
 *   disposer is idempotent and removes nothing if a later registration
 *   has already replaced the record (it never removes someone else's
 *   adapter).
 * @throws {TypeError} If `adapter` is not an object with a non-empty
 *   string `chain` and callable `resolveWallet`/`isValidAddress`.
 */
export function registerWalletAdapter(adapter: WalletAdapter): () => void {
  if (adapter === null || typeof adapter !== 'object') {
    throw new TypeError('registerWalletAdapter: adapter must be an object');
  }
  if (typeof adapter.chain !== 'string' || adapter.chain.length === 0) {
    throw new TypeError('registerWalletAdapter: adapter.chain must be a non-empty string');
  }
  if (typeof adapter.resolveWallet !== 'function' || typeof adapter.isValidAddress !== 'function') {
    throw new TypeError('registerWalletAdapter: adapter must implement resolveWallet and isValidAddress');
  }

  const registry = getRegistry();
  registry.set(adapter.chain, adapter); // last-wins
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (registry.get(adapter.chain) === adapter) registry.delete(adapter.chain);
  };
}

/**
 * Looks up the adapter registered for the exact CAIP-2 `chain` value.
 * No aliasing, no prefix matching — `solana:mainnet-beta` and
 * `solana:devnet` are different keys. Returns `null` when nothing is
 * registered.
 */
export function getWalletAdapter(chain: string): WalletAdapter | null {
  return getRegistry().get(chain) ?? null;
}

// ---------------------------------------------------------------------------
// Wallet-binding storage (v1.2 §3) — WeakMap, in-memory, non-persistent.
// ---------------------------------------------------------------------------

const boundWallets = new WeakMap<object, Map<string, WalletDescriptor>>();

/**
 * Binds a wallet descriptor to an entity instance. Internal delegate for
 * `Identity.bindWallet` / `Handle.bindWallet` (SubHandle inherits).
 * The descriptor is COPIED (`{ ...descriptor }`) so later caller-side
 * mutation cannot change what was bound (v1.2 §3.2). Storage is
 * in-memory and non-persistent: after a restart the binding is gone and
 * the application re-binds (React: effect/context).
 *
 * @throws {TypeError} If `descriptor` is not an object with non-empty
 *   string `chain` and `address`.
 */
export function bindEntityWallet(entity: object, descriptor: WalletDescriptor): void {
  if (descriptor === null || typeof descriptor !== 'object') {
    throw new TypeError('bindWallet: descriptor must be an object');
  }
  if (typeof descriptor.chain !== 'string' || descriptor.chain.length === 0) {
    throw new TypeError('bindWallet: descriptor.chain must be a non-empty string');
  }
  if (typeof descriptor.address !== 'string' || descriptor.address.length === 0) {
    throw new TypeError('bindWallet: descriptor.address must be a non-empty string');
  }
  let perChain = boundWallets.get(entity);
  if (perChain === undefined) {
    perChain = new Map<string, WalletDescriptor>();
    boundWallets.set(entity, perChain);
  }
  perChain.set(descriptor.chain, { ...descriptor });
}

/**
 * Returns the wallet descriptor bound to the entity for the exact
 * `chain`, or `null`. Internal delegate for `getWallet` methods. The
 * adapter registry is NOT consulted here — this reads the binding only
 * (adapters matter at derivation time, not at binding-read time).
 * Entities hold no seed and cannot derive — they read what was bound.
 */
export function getEntityWallet(entity: object, chain: string): WalletDescriptor | null {
  return boundWallets.get(entity)?.get(chain) ?? null;
}
