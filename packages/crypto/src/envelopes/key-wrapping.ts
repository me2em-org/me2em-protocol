// packages/crypto/src/envelopes/key-wrapping.ts

import { initiateX3DH, completeX3DH } from '../x3dh/protocol.js';
import { hkdfWithInfo } from '../core/hkdf.js';
import { importAeadKey, decryptAead } from '../core/aead.js';
import { secureWipe } from '../core/wipe.js';
import { throwCryptoError } from '../errors.js';
import { toBase64 } from '../utils/binary.js';
import type { PreKeyBundle, IdentityKeys, SignedPreKey, OneTimePreKey } from '../x3dh/types.js';

/**
 * A key wrapped for a specific recipient via X3DH-based envelope.
 *
 * Design note (differs from some implementations): the envelope
 * INCLUDES the initiator's Ed25519 identity public key — without
 * it the recipient cannot complete X3DH. Some legacy envelopes
 * omit this field assuming out-of-band knowledge; here it is
 * explicit so envelopes are self-contained.
 */
export interface WrappedKey {
  /** AES-GCM encrypted target key bytes (GCM tag included). */
  wrappedKey: Uint8Array;
  /** 12-byte IV. */
  iv: Uint8Array;
  /** Initiator's ephemeral X25519 public key (from X3DH). */
  ephemeralPublicKey: Uint8Array;
  /** Initiator's Ed25519 identity public key — needed by the
   * recipient to complete X3DH. */
  initiatorIdentityPublicKey: Uint8Array;
  /** Base64 of the consumed OTK public key — recipient uses it
   * to select their matching OTK private key. */
  usedOneTimePreKeyId: string;
  /** Envelope version. */
  v: 1;
}

export interface WrapKeyParams {
  /** The 32-byte key to wrap (e.g. a group key or file key). */
  keyBytes: Uint8Array;
  /** Recipient's published PreKeyBundle (SPK signature will be
   * re-verified inside initiateX3DH). */
  recipientBundle: PreKeyBundle;
  /** Initiator's Ed25519 identity key pair. */
  myIdentity: IdentityKeys;
  /** Application context salt (e.g. groupId, recordingId). MUST
   * be identical for wrap and unwrap. */
  contextSalt: Uint8Array;
  /** Purpose string, e.g. 'me2em/crypto/v1/group-key'. */
  info: string;
}

/**
 * Wraps a key for an OFFLINE recipient via X3DH envelope.
 *
 * Flow: X3DH initiation against the recipient's bundle → derive a
 * one-time wrapping key → AES-256-GCM encrypt the target key.
 *
 * ─────────────────────────────────────────────────────────────
 * Security properties
 * ─────────────────────────────────────────────────────────────
 *
 * - Forward secrecy at handshake: the ephemeral X25519 key is
 *   fresh per envelope; the wrapping key cannot be recomputed
 *   from long-lived keys alone.
 * - Offline delivery: the recipient unwraps whenever they next
 *   come online, using their persisted pre-key material.
 * - MITM defense: the recipient's SPK signature is verified
 *   inside initiateX3DH.
 *
 * @example
 * ```ts
 * // Group owner delivers the group key to each member:
 * const wrapped = await wrapKeyForRecipient({
 *   keyBytes: groupKey, recipientBundle: memberBundle,
 *   myIdentity: ownerIdentity,
 *   contextSalt: new TextEncoder().encode(groupId),
 *   info: 'me2em/crypto/v1/group-key',
 * });
 * // upload `wrapped` — the server can store but not open it
 * ```
 */
export async function wrapKeyForRecipient(
  params: WrapKeyParams
): Promise<WrappedKey> {
  if (params.keyBytes.length !== 32) {
    throwCryptoError('INVALID_LENGTH', 'KEY', 'Target key must be exactly 32 bytes');
  }

  const x3dh = await initiateX3DH(params.myIdentity, params.recipientBundle);

  const wrapKey = await hkdfWithInfo(x3dh.sharedSecret, params.contextSalt, params.info, 32);

  const aeadKey = await importAeadKey(wrapKey);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aeadKey,
    params.keyBytes
  );
  const ciphertext = new Uint8Array(ciphertextBuf);

  secureWipe(wrapKey);

  return {
    wrappedKey: ciphertext,
    iv,
    ephemeralPublicKey: x3dh.ephemeralPublicKey,
    initiatorIdentityPublicKey: params.myIdentity.publicKey,
    usedOneTimePreKeyId: x3dh.usedOneTimePreKeyId!,
    v: 1,
  };
}

export interface UnwrapKeyParams {
  wrapped: WrappedKey;
  /** Recipient's identity key pair. */
  myIdentity: IdentityKeys;
  /** Recipient's SPK (the one matching the bundle the initiator used). */
  mySignedPreKey: SignedPreKey;
  /** Recipient's OTK matching usedOneTimePreKeyId — REQUIRED
   * (initiateX3DH enforces OTK; unwrap mirrors it). */
  myOneTimePreKey: OneTimePreKey;
  contextSalt: Uint8Array;
  info: string;
}

/**
 * Unwraps a key envelope on the recipient side. Completes the
 * same X3DH the initiator started, derives the identical wrapping
 * key, decrypts.
 *
 * @throws {CryptoError} 'DECRYPTION_FAILED' if the envelope was
 *   wrapped for a different key set (wrong OTK / wrong identity),
 *   or the envelope is corrupted. Mirrors completeX3DH
 *   strictness: myOneTimePreKey is REQUIRED.
 */
export async function unwrapKeyForMe(
  params: UnwrapKeyParams
): Promise<Uint8Array> {
  if (params.wrapped.v !== 1) {
    throwCryptoError('UNSUPPORTED_VERSION', 'FORMAT', `WrappedKey version ${params.wrapped.v} is not supported`);
  }

  const sharedSecret = await completeX3DH(
    params.myIdentity,
    params.mySignedPreKey,
    params.myOneTimePreKey,
    params.wrapped.initiatorIdentityPublicKey,
    params.wrapped.ephemeralPublicKey
  );

  const wrapKey = await hkdfWithInfo(sharedSecret, params.contextSalt, params.info, 32);

  const aeadKey = await importAeadKey(wrapKey);

  const plaintext = await decryptAead(aeadKey, params.wrapped.wrappedKey, params.wrapped.iv);

  secureWipe(wrapKey);

  return plaintext;
}
