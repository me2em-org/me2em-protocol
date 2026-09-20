// packages/crypto/src/x3dh/prekeys.ts

import { generateX25519KeyPair } from '../core/ecdh.js';
import { generateSignedPreKey } from './protocol.js';
import { toBase64 } from '../utils/binary.js';
import { throwCryptoError } from '../errors.js';
import type {
  PreKeyBundle,
  SignedPreKey,
  OneTimePreKey,
  IdentityKeys,
} from './types.js';

export interface PreKeyBatch {
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
  oneTimePreKeyPublicB64: string[];
}

/**
 * Generates a PreKey batch: 1 Signed Pre-Key + N One-Time Pre-Keys.
 *
 * The SPK is signed with the identity key. OTKs are raw X25519
 * keypairs. All keypairs are 32-byte X25519 (not Ed25519).
 *
 * This is called by the client when the server reports the OTK
 * store is below the refill threshold (50, per BL-27).
 *
 * @param identity - Identity key pair (Ed25519).
 * @param otkCount - Number of OTKs (default 100).
 * @returns PreKeyBatch with SPK, OTKs, and OTK public key b64 list.
 * @throws {CryptoError} 'INVALID_ARGUMENT' if otkCount > 1000.
 *
 * @example
 * ```ts
 * const batch = generatePreKeyBatch(identity, 100);
 * // publish batch.signedPreKey + batch.oneTimePreKeyPublicB64 to server
 * ```
 */
export function generatePreKeyBatch(
  identity: IdentityKeys,
  otkCount: number = 100
): PreKeyBatch {
  if (otkCount < 1 || otkCount > 1000) {
    throwCryptoError(
      'INVALID_ARGUMENT',
      'KEY',
      'otkCount must be 1..1000'
    );
  }

  const signedPreKey = generateSignedPreKey(identity);
  const oneTimePreKeys: OneTimePreKey[] = Array.from({ length: otkCount }, () => {
    const kp = generateX25519KeyPair();
    return { keyPair: kp };
  });
  const oneTimePreKeyPublicB64 = oneTimePreKeys.map((otk) =>
    toBase64(otk.keyPair.publicKey)
  );

  return { signedPreKey, oneTimePreKeys, oneTimePreKeyPublicB64 };
}

/**
 * Builds a publishable PreKeyBundle from a batch for the server.
 *
 * Includes: identity public key + SPK public key + SPK signature +
 * optionally one OTK public key by index.
 *
 * @param batch - The PreKeyBatch to extract from.
 * @param identityPub - Recipient's Ed25519 public key.
 * @param pickOtkIndex - Optional index of an OTK to include (0-based).
 * @returns PreKeyBundle ready for server upload.
 *
 * @example
 * ```ts
 * const bundle = publishableBundle(batch, identityPub, 42);
 * // bundle.oneTimePreKeyPublicKey = batch.oneTimePreKeys[42].publicKey
 * ```
 */
export function publishableBundle(
  batch: PreKeyBatch,
  identityPub: Uint8Array,
  pickOtkIndex?: number
): PreKeyBundle {
  const bundle: PreKeyBundle = {
    identityPublicKey: identityPub,
    signedPreKeyPublicKey: batch.signedPreKey.keyPair.publicKey,
    signedPreKeySignature: batch.signedPreKey.signature,
  };

  if (pickOtkIndex !== undefined) {
    if (pickOtkIndex < 0 || pickOtkIndex >= batch.oneTimePreKeys.length) {
      throwCryptoError(
        'INVALID_ARGUMENT',
        'KEY',
        `OTK index ${pickOtkIndex} out of range [0..${batch.oneTimePreKeys.length - 1}]`
      );
    }
    bundle.oneTimePreKeyPublicKey = batch.oneTimePreKeys[pickOtkIndex].keyPair.publicKey;
  }

  return bundle;
}
