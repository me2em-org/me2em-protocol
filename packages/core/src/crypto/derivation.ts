// packages/core/src/crypto/derivation.ts
//
// Key-derivation helpers shared by every derivation entry point
// (PR-10, tasks 3.2/5.3.3). `Identity.fromSeed`, `Identity.deriveHandle`,
// `Identity.deriveSubHandle` and `Handle.deriveSubHandle` all route
// through these functions, which is what guarantees the byte-parity the
// spec pins (specs/v1.0.md §3): the two-step derivation
// (`handle.deriveSubHandle`) and the atomic derivation
// (`identity.deriveSubHandle`) MUST produce the same SubHandle key.
//
// All functions derive with HKDF-SHA256 (RFC 5869), salt = "" (zero
// length), 32-byte output — see specs/v1.0.md §3. The info strings come
// exclusively from {@link DERIVATION_PATHS} (single source of truth).

import { hkdf } from './hkdf.js';
import { DERIVATION_PATHS } from './derivation-paths.js';

/**
 * Derives the root Identity key from the 64-byte seed.
 *
 * `HKDF-SHA256(seed, salt = "", info = "me2em/identity/v1/root", 32)`
 * (specs/v1.0.md §2–§3). This is the exact computation
 * `Identity.fromSeed` performs; exposed so advanced callers can
 * reproduce or audit the derivation without holding an Identity
 * instance.
 *
 * @param seed - The 64-byte BIP39 seed (specs/v1.0.md §2).
 * @returns The 32-byte Ed25519 root private key.
 * @since 0.8.0
 */
export function deriveRootKey(seed: Uint8Array): Uint8Array {
  return hkdf(
    seed,
    new Uint8Array(0),
    new TextEncoder().encode(DERIVATION_PATHS.identity),
    32
  );
}

/**
 * Derives a Handle key from the root Identity key.
 *
 * `HKDF-SHA256(rootKey, salt = "", info = "me2em/handle/v1/{name}", 32)`.
 * `name` is canonicalized (NFKC → lowercase → trim) by
 * {@link DERIVATION_PATHS.handle}.
 *
 * @param rootKey - The 32-byte root private key (see {@link deriveRootKey}).
 * @param name - The Handle name.
 * @returns The 32-byte Ed25519 Handle private key.
 * @since 0.8.0
 */
export function deriveHandleKey(rootKey: Uint8Array, name: string): Uint8Array {
  return hkdf(
    rootKey,
    new Uint8Array(0),
    new TextEncoder().encode(DERIVATION_PATHS.handle(name)),
    32
  );
}

/**
 * Derives a SubHandle key from its parent Handle key — the single
 * implementation shared by `Handle.deriveSubHandle` (autonomous,
 * two-step from the Handle) and `Identity.deriveSubHandle` (atomic,
 * from the Identity). Byte-parity of both entry points is pinned by
 * test 5.3.3 (`derivation.spec.ts`) and by the golden vectors.
 *
 * `HKDF-SHA256(handleKey, salt = "",
 * info = "me2em/subhandle/v1/{handleName}/{subName}", 32)`. Both names
 * are canonicalized (NFKC → lowercase → trim) by
 * {@link DERIVATION_PATHS.subhandle}.
 *
 * @param handleKey - The 32-byte parent Handle private key.
 * @param handleName - The parent Handle name.
 * @param subName - The SubHandle name.
 * @returns The 32-byte Ed25519 SubHandle private key.
 * @since 0.8.0
 */
export function deriveSubHandleKey(
  handleKey: Uint8Array,
  handleName: string,
  subName: string
): Uint8Array {
  return hkdf(
    handleKey,
    new Uint8Array(0),
    new TextEncoder().encode(DERIVATION_PATHS.subhandle(handleName, subName)),
    32
  );
}
