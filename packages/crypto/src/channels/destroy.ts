// packages/crypto/src/channels/destroy.ts

import { getInternals, dropInternals } from './state.js';
import { secureWipe } from '../core/wipe.js';
import type { Channel } from './types.js';

/**
 * Destroys a channel explicitly (D4): wipes the root key material,
 * clears the replay window and drops the internals.
 *
 * Use for application-side teardown (logout, conversation deletion,
 * compromise response) — anywhere a channel should stop existing
 * NOW rather than when the object gets garbage-collected. This
 * complements rotateChannel: rotation invalidates the old object
 * implicitly, destroyChannel invalidates THE GIVEN object on
 * purpose.
 *
 * What gets cleaned:
 * - rootKeyMaterial — wiped with the two-pass secureWipe schedule.
 * - seenSeqs (replay window) — cleared, then dropped with the rest
 *   of the internals.
 * - Internals entry — removed from the module-private WeakMap, so
 *   the channel object becomes permanently dead.
 *
 * Nothing else needs cleanup: per-message keys are derived per
 * operation and wiped immediately after importKey; no CryptoKey is
 * retained on the channel.
 *
 * NOT idempotent on purpose: the first call is the only one that
 * finds internals — every subsequent operation on the destroyed
 * channel (encrypt, decrypt, rotate, a repeated destroyChannel)
 * throws INVALID_KEY ("Unknown or destroyed channel").
 *
 * @param channel - The channel to destroy.
 * @throws {CryptoError} If channel is not a Channel object
 *   (INVALID_ARGUMENT) or is already destroyed/unknown
 *   (INVALID_KEY).
 *
 * @example
 * ```ts
 * destroyChannel(channel);
 * // channel is now dead — every operation throws
 * ```
 */
export function destroyChannel(channel: Channel): void {
  const internals = getInternals(channel);
  secureWipe(internals.rootKeyMaterial);
  internals.seenSeqs.clear();
  dropInternals(channel);
}
