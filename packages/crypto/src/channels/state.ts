// packages/crypto/src/channels/state.ts

import type { Channel, ChannelInternals } from './types.js';
import { CHANNEL_BRAND } from './types.js';
import { throwCryptoError } from '../errors.js';

const internals = new WeakMap<Channel, ChannelInternals>();

/** Internal view of a Channel with the runtime brand attached (D1). */
type BrandedChannel = Channel & { readonly [CHANNEL_BRAND]?: true };

/**
 * Runtime brand check (D1): is this value a Channel produced by
 * establishChannel/rotateChannel? Plain objects, spread-clones and
 * other impostors are rejected BEFORE the
 * WeakMap lookup, so impostor input fails with a precise
 * INVALID_ARGUMENT instead of a misleading INVALID_KEY.
 *
 * @internal — used by channel functions, not exported from index.
 */
export function isChannel(value: unknown): value is Channel {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BrandedChannel)[CHANNEL_BRAND] === true
  );
}

/**
 * Attaches the runtime brand (D1) to a freshly created channel
 * object. The property is non-enumerable (spread-clones lose it and
 * fail isChannel) and non-configurable (it cannot be stripped).
 * MUST be called before Object.freeze — defineProperty throws on a
 * frozen object.
 *
 * @internal
 */
export function brandChannel(channel: Channel): void {
  Object.defineProperty(channel, CHANNEL_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** @internal — used by channel functions, not exported from index. */
export function getInternals(channel: Channel): ChannelInternals {
  if (!isChannel(channel)) {
    throwCryptoError(
      'INVALID_ARGUMENT',
      'KEY',
      'Not a Channel — pass the object returned by establishChannel/rotateChannel'
    );
  }
  const s = internals.get(channel);
  if (!s) {
    throwCryptoError(
      'INVALID_KEY',
      'KEY',
      'Unknown or destroyed channel — establish or rotate it first'
    );
  }
  return s;
}

/** @internal */
export function setInternals(channel: Channel, s: ChannelInternals): void {
  internals.set(channel, s);
}

/** @internal — removes state (old channel after rotate/destroy). */
export function dropInternals(channel: Channel): void {
  internals.delete(channel);
}
