// packages/core/src/crypto/ed25519.ts
//
// Documented wrappers around the @noble/ed25519 primitives used by the
// protocol. These are real functions rather than alias re-exports, so
// generated documentation is fully owned by this package and never
// inherits comments (or broken links) from the upstream library.

import { ed } from './init.js';

/** Verification options, forwarded to the underlying implementation. */
type VerifyOpts = Parameters<typeof ed.verify>[3];

/**
 * Derives the Ed25519 public key for a private key (synchronous).
 *
 * @param privateKey - 32-byte Ed25519 private key.
 * @returns The 32-byte public key.
 * @throws `TypeError` if the key length is invalid.
 * @throws `RangeError` if the key length is invalid.
 */
export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed.getPublicKey(privateKey);
}

/**
 * Signs a message with an Ed25519 private key (synchronous).
 *
 * @param message - The bytes to sign.
 * @param privateKey - 32-byte Ed25519 private key.
 * @returns The 64-byte signature.
 * @throws `TypeError` if an input length is invalid.
 * @throws `RangeError` if an input length is invalid.
 */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed.sign(message, privateKey);
}

/**
 * Verifies an Ed25519 signature (synchronous).
 *
 * @param signature - The 64-byte signature.
 * @param message - The signed message bytes.
 * @param publicKey - The 32-byte signer public key.
 * @param opts - Optional verification options, forwarded to the
 *   underlying implementation.
 * @returns `true` if the signature is valid, `false` otherwise.
 * @throws `TypeError` if an input length is invalid.
 * @throws `RangeError` if an input length is invalid.
 */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
  opts?: VerifyOpts
): boolean {
  return ed.verify(signature, message, publicKey, opts);
}

/**
 * Asynchronous variant of {@link getPublicKey}; same contract.
 */
export async function getPublicKeyAsync(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(privateKey);
}

/**
 * Asynchronous variant of {@link sign}; same contract.
 */
export async function signAsync(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey);
}

/**
 * Asynchronous variant of {@link verify}; same contract.
 *
 * @param opts - Optional verification options, forwarded to the
 *   underlying implementation.
 */
export async function verifyAsync(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
  opts?: Parameters<typeof ed.verifyAsync>[3]
): Promise<boolean> {
  return ed.verifyAsync(signature, message, publicKey, opts);
}