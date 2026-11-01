// packages/core/src/crypto/index.ts

/**
 * The `crypto` namespace: low-level cryptographic primitives and the
 * derivation module of the protocol.
 *
 * Two groups live here:
 *
 * - **Derivation (HKDF-SHA256, RFC 5869):** `deriveRootKey`,
 *   `deriveHandleKey`, `deriveSubHandleKey`, `rawX25519SharedSecret`,
 *   plus the frozen {@link DERIVATION_PATHS} info-string registry.
 *   These are the derivation functions of specs/v1.0.md §3 —
 *   deterministic, versioned, byte-pinned by the golden vectors.
 * - **Raw primitives (Ed25519, RFC 8032):** `getPublicKey`, `sign`,
 *   `verify` and their `*Async` variants, plus the `hkdf` / `sha256`
 *   helpers — documented wrappers around the configured `@noble`
 *   backend (see the ed25519 module header for why they exist as real
 *   functions). Building blocks for tooling outside the token flow;
 *   the protocol itself signs through `Identity` / `Handle` /
 *   `SubHandle`, which implement `Signer`.
 *
 * The namespace is part of the frozen public API (specs/v1.0.md §12).
 * Note: `derivePassword` and `deriveChannelKey` are `Handle` methods,
 * not namespace members.
 */

export * from './ed25519.js';
export * from './hkdf.js';
export * from './derivation-paths.js';
export * from './derivation.js';
export * from './ecdh.js';