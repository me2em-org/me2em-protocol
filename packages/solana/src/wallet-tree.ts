// packages/solana/src/wallet-tree.ts
//
// SolanaWalletTree (Документ 2 v1.2 §4.1) — the deterministic wallet
// derivation context that replaces the impossible-in-core
// `Identity.resolveWallet`: entities hold no seed and cannot derive,
// so the seed lives HERE, scoped to this tree, and dies with
// `dispose()`.
//
// Derivation is delegated entirely to `crypto.slip10` (Ф-crypto):
// @me2em/solana carries NO SLIP-0010 implementation of its own and
// imports no curve library — it composes the canonical Solana payment
// path, base58-encodes the derived public key and manages key
// lifetime (wipe on dispose, fresh buffers per derivation).
//
// Error contract: seed/index violations are programmer errors and
// throw bare `TypeError` (mirroring `crypto.slip10` and
// `Identity.fromSeed`); using a disposed tree throws `DisposedError`
// from @me2em/core (the whole me2em surface is catchable as one
// error family).

import { DisposedError } from '@me2em/core';
import { base58 } from '@scure/base';
import { secureWipe, slip10 } from '@me2em/crypto';

/** BIP-44 coin type for Solana (slip-0044). */
const SOLANA_COIN_TYPE = 501;

/** 2^31 − 1 — the largest plain (pre-hardening) path component. */
const MAX_PLAIN_INDEX = 0x7fffffff;

/**
 * The canonical Solana payment path (v1.2 §4.1; the path grammar
 * `crypto.slip10.derivePath` consumes): account = index, address
 * level fixed at 0.
 */
function paymentPath(index: number): string {
  return `m/44'/${SOLANA_COIN_TYPE}'/${index}'/0'`;
}

/**
 * Recognizes the paths this tree issues — `m/44'/501'/N'/0'` — with
 * the plain index captured. Deliberately a SUPerset of what the tree
 * emits: the index alternative is `(\d+)`, not the canonical
 * `(0|[1-9][0-9]*)`, so a padded rendering persisted by external
 * tooling (`m/44'/501'/00'/0'`) still counts as used — rejecting it
 * could reallocate an existing index (address reuse), the exact
 * failure v1.2 §2.2 forbids. `Number()` canonicalizes the capture
 * (`'007'` → 7) and the range check drops overflows; the capture is
 * never fed to `derivePath` as a string (issuance goes through
 * {@link paymentPath} with a validated number), so liberal matching
 * here has no derivation surface. Everything else (foreign coin
 * types, missing levels, non-numeric junk) is not ours and is
 * ignored by {@link nextPaymentIndex}, never thrown on (v1.2 §2.2
 * tolerance).
 */
const PAYMENT_PATH_RE = /^m\/44'\/501'\/(\d+)'\/0'$/;

/**
 * Chain-scoped index allocation from used derivation paths
 * (v1.2 §2.2): paths this package cannot parse are ignored; an empty
 * input — or one empty after filtering — yields `0`; otherwise
 * `max(indexes) + 1`, so holes are never reused. Pure function —
 * the caller persists the used paths (from attestation
 * `subjectWalletPath` values), neither the tree nor the adapter
 * keeps state.
 *
 * @throws {TypeError} if `usedPaths` is not an array.
 */
export function nextPaymentIndex(usedPaths: string[]): number {
  if (!Array.isArray(usedPaths)) {
    throw new TypeError('nextIndex: usedPaths must be an array of derivation-path strings');
  }
  let max = -1;
  for (const path of usedPaths) {
    if (typeof path !== 'string') continue; // tolerate mixed input, never throw
    const match = PAYMENT_PATH_RE.exec(path);
    if (match === null) continue;
    const index = Number(match[1]);
    // Paths beyond the derivable plain-index range are not actionable
    // for allocation — ignore them like any other foreign path.
    if (!(index >= 0 && index <= MAX_PLAIN_INDEX)) continue;
    if (index > max) max = index;
  }
  return max + 1; // empty / all-filtered → 0 (no Math.max(-Infinity) trap)
}

/** A wallet derived from the tree: the raw signing seed and its address. */
export interface SolanaDerivedWallet {
  /** Base58 of the 32-byte Ed25519 public key — the Solana address. */
  readonly address: string;
  /**
   * 32-byte Ed25519 private key (the SLIP-0010 node key). Fresh
   * buffer — never shared with the tree's master material. The caller
   * MUST wipe it after use (`secureWipe` from @me2em/crypto).
   */
  readonly privateKey: Uint8Array;
  /** The canonical path used, e.g. `m/44'/501'/0'/0'`. */
  readonly derivationPath: string;
}

/**
 * Deterministic Solana wallet tree over one 64-byte seed
 * (Документ 2 v1.2 §4.1).
 *
 * - **Seed contract — exactly 64 bytes**, the same as
 *   `Identity.fromSeed` / `crypto.slip10.masterKeyFromSeed`; anything
 *   else throws `TypeError`.
 * - **The seed is never retained.** `fromSeed` derives the master
 *   node once and keeps ONLY the 32-byte IL/IR pair in `#private`
 *   fields; the caller's buffer is neither read again nor wiped
 *   (the caller owns it). Mutating the seed after `fromSeed` never
 *   changes subsequent derivations.
 * - **Fresh buffers.** `deriveWallet` returns a freshly derived
 *   private key; the tree's master material is never exposed, and the
 *   child chain code (not returned) is wiped immediately.
 * - **Dispose wipes.** `dispose()` zeroizes the master key material;
 *   every key-requiring call afterwards throws `DisposedError`.
 *
 * @example
 * ```ts
 * import { SolanaWalletTree } from '@me2em/solana';
 * import { secureWipe } from '@me2em/crypto';
 *
 * const tree = SolanaWalletTree.fromSeed(seed64);
 * try {
 *   const { address, privateKey, derivationPath } = await tree.deriveWallet(0);
 *   // … sign / bind / attest …
 *   secureWipe(privateKey); // caller MUST wipe
 * } finally {
 *   tree.dispose();
 * }
 * ```
 */
export class SolanaWalletTree {
  /**
   * Builds the tree from a 64-byte seed.
   *
   * The seed is CONSUMED by derivation and NOT retained (only the
   * derived master key + chain code are kept, in private fields); the
   * caller's buffer is not wiped — the caller owns it.
   *
   * @throws {TypeError} if `seed` is not a `Uint8Array` of exactly
   *   64 bytes (delegated contract of `crypto.slip10.masterKeyFromSeed`).
   */
  static fromSeed(seed: Uint8Array): SolanaWalletTree {
    const master = slip10.masterKeyFromSeed(seed);
    return new SolanaWalletTree(master.key, master.chainCode);
  }

  #masterKey: Uint8Array;
  #masterChainCode: Uint8Array;
  #disposed = false;

  private constructor(masterKey: Uint8Array, masterChainCode: Uint8Array) {
    this.#masterKey = masterKey;
    this.#masterChainCode = masterChainCode;
  }

  #assertLive(): void {
    if (this.#disposed) throw new DisposedError('SolanaWalletTree');
  }

  /**
   * Derives the payment wallet at `index`:
   * `m/44'/501'/{index}'/0'` → SLIP-0010 ed25519 → base58 address.
   *
   * Deterministic: the same seed and index always produce a
   * byte-identical address and private key.
   *
   * @returns The derived wallet. The caller MUST wipe
   *   `privateKey` after use (`secureWipe`).
   * @throws {DisposedError} after {@link SolanaWalletTree.dispose}.
   * @throws {TypeError} if `index` is not a safe integer in
   *   `0..2^31 − 1`.
   */
  async deriveWallet(index: number): Promise<SolanaDerivedWallet> {
    this.#assertLive();
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > MAX_PLAIN_INDEX) {
      throw new TypeError(
        `Solana payment index must be a safe integer in 0..2^31 − 1, got ${String(index)}`
      );
    }
    const path = paymentPath(index);
    // derivePath copies its input and never mutates or retains the
    // master fields; the returned node owns fresh buffers.
    const node = slip10.derivePath({ key: this.#masterKey, chainCode: this.#masterChainCode }, path);
    const address = base58.encode(slip10.publicKey(node));
    const wallet: SolanaDerivedWallet = {
      address,
      privateKey: node.key, // fresh buffer from derivePath — handed to the caller
      derivationPath: path,
    };
    secureWipe(node.chainCode); // hygiene: the child chain code is not returned
    return wallet;
  }

  /**
   * Chain-scoped index allocation over used `m/44'/501'/N'/0'` paths
   * (v1.2 §2.2) — pure planning over the caller's persisted paths.
   * Needs no key material, so it keeps working after
   * {@link SolanaWalletTree.dispose}.
   *
   * @throws {TypeError} if `usedPaths` is not an array.
   */
  nextIndex(usedPaths: string[]): number {
    return nextPaymentIndex(usedPaths);
  }

  /**
   * Zeroizes the master key material. Idempotent. After the FIRST
   * call every key-requiring method throws `DisposedError`
   * (`code === 'DISPOSED'`); `nextIndex` — which needs no key
   * material — keeps working, mirroring core's dispose semantics
   * (capabilities are revoked, information stays).
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    secureWipe(this.#masterKey);
    secureWipe(this.#masterChainCode);
  }
}
