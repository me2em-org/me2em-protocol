// packages/crypto/src/channels/message-keys.ts

import { hkdf } from '../core/hkdf.js';
import { encryptAead, decryptAead } from '../core/aead.js';
import { getInternals } from './state.js';
import { throwCryptoError } from '../errors.js';
import type { Channel, ChannelMessage } from './types.js';

const MSG_INFO = 'me2em/crypto/v1/channel-message';

/**
 * Derives a per-message key from the channel root.
 *
 * MK = HKDF(rootKeyMaterial, salt=epoch ‖ seq, info=MSG_INFO)
 *
 * Fresh key per message — the lightweight per-message pattern
 * (interim FS within an epoch; full ratchet is a separate track).
 *
 * @param rootMaterial - The channel's root key material (32B).
 * @param epoch - Current epoch number.
 * @param seq - Message sequence number.
 * @returns A non-extractable CryptoKey for AES-GCM encrypt/decrypt.
 */
async function deriveMessageKey(
  rootMaterial: Uint8Array,
  epoch: number,
  seq: number
): Promise<CryptoKey> {
  const saltBuf = new Uint8Array(8);
  new DataView(saltBuf.buffer).setUint32(0, epoch, false);
  new DataView(saltBuf.buffer).setUint32(4, seq, false);

  const mkBytes = await hkdf(
    rootMaterial,
    saltBuf,
    new TextEncoder().encode(MSG_INFO),
    32
  );

  const keyBuf = await crypto.subtle.importKey(
    'raw',
    mkBytes.buffer as ArrayBuffer,
    'AES-GCM',
    false,  // non-extractable
    ['encrypt', 'decrypt']
  );

  return keyBuf;
}

/**
 * Encrypts a message for the channel at the given sequence number.
 *
 * The application is responsible for managing sequence counters
 * (immutable design — React-friendly). Each call generates a fresh
 * random IV, so encrypting the same plaintext with the same seq
 * produces different ciphertexts. However, re-encrypting with a
 * seq already used for this channel will fail on decrypt (replay).
 *
 * @param channel - The channel to encrypt for.
 * @param seq - Sequence number (must be ≥ 0).
 * @param plaintext - The plaintext to encrypt.
 * @returns ChannelMessage with epoch, sequence, ciphertext, and IV.
 * @throws {CryptoError} If the channel is unknown (rotated away)
 *   or seq is invalid.
 *
 * @example
 * ```ts
 * const msg = await encryptChannelMessage(channel, 0, plaintext);
 * // send msg.ciphertext + msg.iv + msg.sequence + msg.epoch
 * ```
 */
export async function encryptChannelMessage(
  channel: Channel,
  seq: number,
  plaintext: Uint8Array
): Promise<ChannelMessage> {
  const internals = getInternals(channel);

  if (seq < 0) {
    throwCryptoError('INVALID_ARGUMENT', 'KEY', 'sequence must be >= 0');
  }

  const mk = await deriveMessageKey(
    internals.rootKeyMaterial,
    channel.epoch,
    seq
  );

  const { ciphertext, iv } = await encryptAead(mk, plaintext);

  return {
    epoch: channel.epoch,
    sequence: seq,
    ciphertext,
    iv,
  };
}

/**
 * Decrypts a channel message, with replay protection and epoch checks.
 *
 * Replay protection: msg.sequence must be strictly greater than the
 * last successfully decrypted sequence in this direction. This is
 * a strict increasing-seq policy — out-of-order decryption is
 * rejected (window-based replay protection is a future track).
 *
 * Epoch check: msg.epoch must match the channel's current epoch.
 * Messages from previous epochs are rejected — that is the point
 * of epoch rotation (forward secrecy at rotation points).
 *
 * @param channel - The channel to decrypt for.
 * @param msg - The ChannelMessage to decrypt.
 * @returns The decrypted plaintext.
 * @throws {CryptoError} If channel is unknown, replay detected,
 *   or wrong epoch.
 *
 * @example
 * ```ts
 * const plaintext = await decryptChannelMessage(channel, receivedMsg);
 * ```
 */
export async function decryptChannelMessage(
  channel: Channel,
  msg: ChannelMessage
): Promise<Uint8Array> {
  const internals = getInternals(channel);

  if (msg.epoch !== channel.epoch) {
    throwCryptoError(
      'DECRYPTION_FAILED',
      'CIPHER',
      `Message from a previous epoch (expected ${channel.epoch}, got ${msg.epoch})`
    );
  }

  if (msg.sequence <= internals.lastDecryptedSeq) {
    throwCryptoError(
      'REPLAY_DETECTED',
      'CIPHER',
      'Replay detected — sequence not increasing'
    );
  }

  const mk = await deriveMessageKey(
    internals.rootKeyMaterial,
    msg.epoch,
    msg.sequence
  );

  const plaintext = await decryptAead(mk, msg.ciphertext, msg.iv);

  internals.lastDecryptedSeq = msg.sequence;

  return plaintext;
}
