// packages/crypto/src/core/slip10.ts
//
// SLIP-0010 ed25519 hierarchical key derivation (hardened-only).
//
// This is the Ф-crypto phase of the payment-layer plan (Документ 2
// v1.2): SLIP-0010 lives in @me2em/crypto and is consumed as
// `crypto.slip10`. Chain packages (e.g. @me2em/solana) carry no SLIP
// implementation of their own — they build paths on top of this
// namespace and derive payment addresses from the resulting public
// keys.
//
// Algorithm (slip-0010.md, ed25519):
// - master:  I = HMAC-SHA512(Key = "ed25519 seed", Data = seed);
//   IL = master key, IR = chain code. For ed25519 ANY IL is a valid
//   private key seed, so unlike NIST curves there is no retry loop.
// - CKDpriv (hardened only):
//     I  = HMAC-SHA512(Key = c_par, Data = 0x00 || ser256(k_par) || ser32(i))
//     ki = IL, ci = IR
//   ser32(i) is big-endian; i MUST carry the hardening bit (i ≥ 2^31).
//   Normal (non-hardened) derivation is not defined for ed25519 —
//   slip-0010.md reserves it for curves with an efficient public-key
//   parent operation (secp256k1/NIST); for ed25519 a non-hardened
//   component is a TypeError, not a fallback.
//
// Error contract: every violation of the seed contract (exactly 64
// bytes), the hardened-only rule, or the path grammar throws a bare
// `TypeError` — this mirrors the seed contract of @me2em/core's
// `Identity.fromSeed` and keeps these guards distinct from the
// CryptoError runtime-error model (they are programmer errors, not
// operational failures).

import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha512.js';
import { ed25519 } from '@noble/curves/ed25519.js';

/** HMAC-SHA512 key identifying the ed25519 curve (SLIP-0010, ASCII). */
const ED25519_CURVE_KEY = new TextEncoder().encode('ed25519 seed');

/** The hardening bit: i ≥ 2^31 marks a hardened index (SLIP-0010). */
const HARDENED_BIT = 0x80000000;

/** Maximum ser32 index value. */
const MAX_INDEX = 0xffffffff;

/** 2^31 − 1 — the largest plain (pre-hardening) path component. */
const MAX_PLAIN_INDEX = 0x7fffffff;

/** A SLIP-0010 node: a 32-byte private key and its 32-byte chain code. */
export interface Slip10Node {
  /** 32-byte private key (IL). Ed25519 treats it as a seed — it is clamped internally at signing time. */
  readonly key: Uint8Array;
  /** 32-byte chain code (IR). */
  readonly chainCode: Uint8Array;
}

/**
 * Validates a SLIP-0010 node invariants (32-byte key and chain code).
 * Fail-closed: a malformed node must never reach HMAC with a shorter
 * key (that would silently derive from attacker-chosen data).
 */
function assertNode(node: Slip10Node, origin: string): void {
  if (!(node.key instanceof Uint8Array) || node.key.length !== 32) {
    throw new TypeError(`${origin}: node.key must be a 32-byte Uint8Array`);
  }
  if (!(node.chainCode instanceof Uint8Array) || node.chainCode.length !== 32) {
    throw new TypeError(`${origin}: node.chainCode must be a 32-byte Uint8Array`);
  }
}

/**
 * SLIP-0010 master node over the FULL spec-legal seed range
 * (128–512 bits, i.e. 16–64 bytes).
 *
 * This is the algorithm-level entry point: the official SLIP-0010
 * ed25519 test vectors (Test Vector 1) use a 16-byte seed, so the
 * vector tests exercise this function directly. The PUBLIC contract —
 * {@link slip10.masterKeyFromSeed} — narrows the seed to exactly 64
 * bytes (the BIP39 output and the SLIP-0010 upper bound), matching
 * `Identity.fromSeed`.
 *
 * @param seed - 16..64-byte seed material.
 * @returns The master node: `key` = IL, `chainCode` = IR.
 * @throws {TypeError} if seed is not a Uint8Array of 16–64 bytes.
 */
export function masterKeyFromSeedRaw(seed: Uint8Array): Slip10Node {
  if (!(seed instanceof Uint8Array)) {
    throw new TypeError('seed must be a Uint8Array');
  }
  if (seed.length < 16 || seed.length > 64) {
    throw new TypeError(`SLIP-0010 seed must be 16–64 bytes (128–512 bits), got ${seed.length}`);
  }
  const i = hmac(sha512, ED25519_CURVE_KEY, seed);
  return { key: i.slice(0, 32), chainCode: i.slice(32, 64) };
}

/**
 * Hardened-only private parent key → private child key
 * (CKDpriv, slip-0010.md):
 *
 * ```
 * I  = HMAC-SHA512(Key = c_par, Data = 0x00 || ser256(k_par) || ser32(i))
 * ki = IL, ci = IR
 * ```
 *
 * `ser32(i)` is big-endian. For ed25519 `ki = IL` directly — the
 * key is a signing seed, not a scalar mod n, and the probability of
 * the BIP32 degenerate cases is below 2^-127; the official ed25519
 * vectors are produced exactly this way.
 *
 * @param node - Parent node.
 * @param index - Child index WITH the hardening bit set (2^31 ≤ i ≤ 2^32 − 1).
 * @returns The child node (fresh buffers — input nodes are never mutated).
 * @throws {TypeError} on a malformed node, a non-integer index, or an
 *   index without the hardening bit (ed25519 is hardened-only — see
 *   module docs).
 */
function deriveHardenedChild(node: Slip10Node, index: number): Slip10Node {
  assertNode(node, 'deriveHardened');
  if (typeof index !== 'number' || !Number.isSafeInteger(index)) {
    throw new TypeError(`SLIP-0010 index must be a safe integer, got ${String(index)}`);
  }
  if (index < HARDENED_BIT) {
    throw new TypeError(
      `SLIP-0010 index ${index} is not hardened — ed25519 supports hardened derivation ` +
        `only; pass the index with the hardening bit set (i ≥ 2^31) or use derivePath with a ' marker`
    );
  }
  if (index > MAX_INDEX) {
    throw new TypeError(`SLIP-0010 index must be ≤ 2^32 − 1, got ${index}`);
  }
  // Data = 0x00 || ser256(k_par) || ser32(i), 37 bytes total.
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(33, index, false);
  const i = hmac(sha512, node.chainCode, data);
  return { key: i.slice(0, 32), chainCode: i.slice(32, 64) };
}

/**
 * Hardened-only path derivation from an arbitrary node.
 *
 * Grammar (strict): `m(/(0|[1-9][0-9]*)(`'`|`h`|`H`))*` — the leading
 * `m` is required, every component is decimal without leading zeros
 * and MUST carry a hardening marker; `0 ≤ component ≤ 2^31 − 1`.
 * The bare path `m` is valid and returns a detached copy of the node.
 *
 * The canonical Solana payment path consumed by @me2em/solana is
 * `m/44'/501'/{index}'/0'`.
 *
 * @param node - Starting node (usually the master node).
 * @param path - Hardened derivation path, e.g. `m/44'/501'/0'/0'`.
 * @returns The derived node (fresh buffers).
 * @throws {TypeError} on a malformed node or any grammar violation —
 *   in particular a component without a hardening marker (ed25519 is
 *   hardened-only).
 *
 * @example
 * ```ts
 * const master = slip10.masterKeyFromSeed(seed);
 * const node = slip10.derivePath(master, "m/44'/501'/0'/0'");
 * const pub = slip10.publicKey(node);
 * ```
 */
function deriveChildPath(node: Slip10Node, path: string): Slip10Node {
  // Fail-closed node guard — kept at THIS level, not in the public
  // derivePath wrapper: the bare path "m" returns before the component
  // loop ever reaches deriveHardenedChild, so a wrapper-only guard
  // would let a malformed node through as a "detached copy". The
  // guard inside deriveHardenedChild covers the component loop and
  // the direct slip10.deriveHardened entry; this one covers the
  // caller's node exactly once per call.
  assertNode(node, 'derivePath');
  if (typeof path !== 'string') {
    throw new TypeError('SLIP-0010 path must be a string');
  }
  if (!/^m(\/(0|[1-9][0-9]*)(['hH]))*$/.test(path)) {
    throw new TypeError(
      `SLIP-0010 path must match m(/(0|[1-9][0-9]*)(')…` +
        ` — every component hardened (', h or H), no leading zeros, got ${JSON.stringify(path)}`
    );
  }
  let current: Slip10Node = { key: node.key.slice(), chainCode: node.chainCode.slice() };
  const rest = path.slice(2); // after "m/"
  if (rest === '') return current; // bare "m"
  for (const component of rest.split('/')) {
    const marker = component[component.length - 1];
    const plain = Number(component.slice(0, -1));
    if (marker !== "'" && marker !== 'h' && marker !== 'H') {
      throw new TypeError(
        `SLIP-0010 path component "${component}" is not hardened — ` + 'ed25519 supports hardened derivation only'
      );
    }
    if (!(plain >= 0 && plain <= MAX_PLAIN_INDEX)) {
      throw new TypeError(
        `SLIP-0010 path component ${component} is out of range — plain index must be ≤ 2^31 − 1`
      );
    }
    // Numeric addition, NOT bitwise OR: JS bitwise ops are int32, so
    // (2^31 − 1) | 0x80000000 === −1. plain ≤ 2^31 − 1 is enforced above,
    // so the sum stays within ser32 range.
    current = deriveHardenedChild(current, plain + HARDENED_BIT);
  }
  return current;
}

/**
 * The Ed25519 public key of a SLIP-0010 node.
 *
 * Chain packages compute payment addresses from this key (for Solana:
 * `base58(publicKey)`, no checksum) without importing `@noble/curves`
 * themselves.
 *
 * @param node - A SLIP-0010 node.
 * @returns A fresh 32-byte public key.
 * @throws {TypeError} if the node is malformed.
 */
function nodePublicKey(node: Slip10Node): Uint8Array {
  assertNode(node, 'publicKey');
  return ed25519.getPublicKey(node.key);
}

/**
 * SLIP-0010 ed25519 hierarchical derivation (hardened-only) — the
 * crypto foundation for chain-package wallet trees
 * (payment-layer plan, Ф-crypto; consumed as `crypto.slip10`).
 *
 * - **Seed contract — exactly 64 bytes**, the same seed contract as
 *   `Identity.fromSeed` (64 bytes; also the SLIP-0010 upper bound of
 *   512 bits). Anything else throws `TypeError`.
 * - **Hardened only.** Normal derivation is not defined for ed25519;
 *   an index without the hardening bit (or a path component without a
 *   `'`/`h`/`H` marker) throws `TypeError`.
 * - **Deterministic and allocation-fresh.** The same seed and path
 *   always produce byte-identical nodes; returned buffers are fresh
 *   copies — input nodes and seeds are never retained or mutated.
 *   Callers own the returned key material and MUST wipe private keys
 *   after use (`secureWipe`).
 *
 * @example
 * ```ts
 * import { slip10, secureWipe } from '@me2em/crypto';
 *
 * const master = slip10.masterKeyFromSeed(seed);          // 64-byte BIP39 seed
 * const node = slip10.derivePath(master, "m/44'/501'/0'/0'");
 * const pub = slip10.publicKey(node);                     // 32 bytes
 * secureWipe(node.key);
 * ```
 */
export const slip10 = {
  /**
   * SLIP-0010 master node from a seed.
   *
   * @param seed - Exactly 64 bytes — same seed contract as
   *   `Identity.fromSeed` (64 bytes, the SLIP-0010 upper bound).
   * @returns `{ key, chainCode }` — `I = HMAC-SHA512(Key = "ed25519 seed",
   *   Data = seed)`; IL is the master key, IR the chain code. For
   *   ed25519 any IL is valid — no retry loop.
   * @throws {TypeError} if the seed is not a Uint8Array of exactly 64 bytes.
   */
  masterKeyFromSeed(seed: Uint8Array): Slip10Node {
    if (!(seed instanceof Uint8Array)) {
      throw new TypeError('seed must be a Uint8Array');
    }
    if (seed.length !== 64) {
      throw new TypeError(
        `seed must be exactly 64 bytes (same seed contract as Identity.fromSeed), got ${seed.length}`
      );
    }
    return masterKeyFromSeedRaw(seed);
  },

  /**
   * Hardened-only CKDpriv one level down.
   *
   * @param node - Parent node.
   * @param index - Child index WITH the hardening bit: 2^31 ≤ i ≤ 2^32 − 1
   *   (e.g. `0x80000000` for `m/0'`). A non-hardened index throws
   *   `TypeError` — use {@link slip10.derivePath} for marker-based paths.
   * @returns The child node (fresh buffers).
   * @throws {TypeError} on a malformed node or an invalid index.
   */
  deriveHardened(node: Slip10Node, index: number): Slip10Node {
    return deriveHardenedChild(node, index);
  },

  /**
   * Hardened-only path derivation — see the module grammar:
   * `m/44'/501'/0'/0'`; every component hardened, no leading zeros.
   * @throws {TypeError} on a malformed node or any grammar violation.
   */
  derivePath(node: Slip10Node, path: string): Slip10Node {
    return deriveChildPath(node, path);
  },

  /**
   * The 32-byte Ed25519 public key of a node (chain packages derive
   * payment addresses from it — for Solana `base58(publicKey)`).
   * @throws {TypeError} if the node is malformed.
   */
  publicKey(node: Slip10Node): Uint8Array {
    return nodePublicKey(node);
  },
} as const;
