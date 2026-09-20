// packages/crypto/src/channels/rotate.ts

import { hkdf } from '../core/hkdf.js';
import { getInternals, setInternals, dropInternals } from './state.js';
import type { Channel } from './types.js';
import { secureWipe } from '../core/wipe.js';

/**
 * Rotates the channel root key: epoch+1, fresh root material,
 * sequence reset.
 *
 * ─────────────────────────────────────────────────────────────
 * What rotation achieves
 * ─────────────────────────────────────────────────────────────
 *
 * - Forward secrecy at ROTATION POINTS: compromise of the current
 *   root does NOT reveal messages encrypted under previous epochs.
 * - This is epoch rotation, NOT a Double Ratchet: rotation is an
 *   explicit application decision (e.g. on membership change,
 *   on timer, on explicit user action).
 *
 * Derivation: newRoot = HKDF(oldRoot, salt='rotate', info=epoch+1)
 * The old root material is wiped. Messages from previous epochs
 * become undecryptable — that is the point.
 *
 * @param channel - The channel to rotate (mutated in place, new object returned).
 * @returns A NEW Channel object with epoch+1 and fresh internals.
 *   The old channel object is immediately invalidated (internals dropped).
 *
 * @example
 * ```ts
 * const newChannel = await rotateChannel(channel);
 * // old channel is now dead — encrypt/decrypt will throw
 * // use newChannel for all subsequent operations
 * ```
 */
export async function rotateChannel(channel: Channel): Promise<Channel> {
  const oldInternals = getInternals(channel);

  const oldEpoch = channel.epoch;
  const newEpoch = oldEpoch + 1;

  // Derive new root material from old
  const saltRotate = new TextEncoder().encode('rotate');
  const infoRotate = new TextEncoder().encode(`epoch:${newEpoch}`);
  const newRootMaterial = await hkdf(
    oldInternals.rootKeyMaterial,
    saltRotate,
    infoRotate,
    32
  );

  // Wipe old root material immediately
  secureWipe(oldInternals.rootKeyMaterial);

  // Drop old channel internals — old channel object becomes dead
  dropInternals(channel);

  // channelId is stable across rotations (derived from original sharedSecret)
  const newChannel: Channel = {
    channelId: channel.channelId,
    epoch: newEpoch,
    role: channel.role,
  };

  setInternals(newChannel, {
    rootKeyMaterial: newRootMaterial,
    lastDecryptedSeq: -1,
  });

  return newChannel;
}
