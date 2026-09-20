// packages/crypto/src/channels/establish.ts

import { hkdfWithInfo } from '../core/hkdf.js';
import { importAeadKey } from '../core/aead.js';
import { toHex, concat } from '../utils/binary.js';
import { setInternals } from './state.js';
import { throwCryptoError } from '../errors.js';
import type { Channel } from './types.js';

/**
 * Computes SHA-256 hash of a Uint8Array and returns it as bytes.
 *
 * @param data - The data to hash.
 * @returns 32-byte SHA-256 hash.
 */
async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuf);
}

/**
 * Establishes a channel from an X3DH shared secret.
 *
 * ─────────────────────────────────────────────────────────────
 * Key hierarchy
 * ─────────────────────────────────────────────────────────────
 *
 * X3DH sharedSecret (32B, raw)
 *   └─ HKDF(sharedSecret, salt=channelSalt, info='…/channel-root/v1')
 *        ├─ rootKeyMaterial (32B) — channel-local secret
 *        └─ channelId = SHA-256(sharedSecret ‖ salt) — stable across rotations
 *
 * Why derive (not use X3DH secret directly)?
 * - The X3DH secret is SHARED history; deriving a channel-local
 *   key allows multiple channels from one X3DH (different salts)
 *   and isolates channels from each other.
 *
 * Key representation:
 * - rootKeyMaterial exists as raw Uint8Array in ChannelInternals
 *   (accessible only via the module-private WeakMap).
 * - rootKey is a non-extractable AES-GCM CryptoKey derived from
 *   rootKeyMaterial for AEAD operations.
 * - Both representations coexist during the channel lifetime;
 *   rootKeyMaterial is only wiped on rotateChannel.
 *
 * @param sharedSecret - 32B from initiateX3DH/completeX3DH.
 * @param channelSalt - Application-provided salt (e.g. chatId).
 *   MUST be identical on both sides. Does not need to be secret.
 * @param role - Direction role: 'initiator' or 'recipient'.
 *   Defaults to 'initiator'. Affects nothing cryptographically
 *   (X3DH is symmetric), but useful for application-side audit.
 * @returns A Channel with epoch=0 and hidden internals.
 * @throws {CryptoError} If sharedSecret length is not 32 bytes.
 *
 * @example
 * ```ts
 * const x3dh = await initiateX3DH(myIdentity, theirBundle);
 * const channel = await establishChannel(x3dh.sharedSecret, 'chat-42');
 * ```
 */
export async function establishChannel(
  sharedSecret: Uint8Array,
  channelSalt: string,
  role: 'initiator' | 'recipient' = 'initiator'
): Promise<Channel> {
  if (sharedSecret.length !== 32) {
    throwCryptoError(
      'INVALID_LENGTH',
      'KEY',
      'sharedSecret must be exactly 32 bytes'
    );
  }

  const saltBytes = new TextEncoder().encode(channelSalt);
  const rootMaterial = await hkdfWithInfo(
    sharedSecret,
    saltBytes,
    'me2em/crypto/v1/channel-root',
    32
  );

  const channelIdHash = await sha256Bytes(concat(sharedSecret, saltBytes));
  const channelId = toHex(channelIdHash).slice(0, 32);

  const rootKey = await importAeadKey(rootMaterial);
  // rootKey is non-extractable AES-GCM CryptoKey; used for AEAD ops.
  // rootKeyMaterial is the raw 32B backing store in internals.

  const channel: Channel = {
    channelId,
    epoch: 0,
    role,
  };

  setInternals(channel, {
    rootKeyMaterial: rootMaterial,
    lastDecryptedSeq: -1,
  });

  return channel;
}
