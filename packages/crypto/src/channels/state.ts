// packages/crypto/src/channels/state.ts

import type { Channel, ChannelInternals } from './types.js';
import { throwCryptoError } from '../errors.js';

const internals = new WeakMap<Channel, ChannelInternals>();

/** @internal — used by channel functions, not exported from index. */
export function getInternals(channel: Channel): ChannelInternals {
  const s = internals.get(channel);
  if (!s) {
    throwCryptoError('INVALID_KEY', 'KEY', 'Unknown channel — establish it first');
  }
  return s;
}

/** @internal */
export function setInternals(channel: Channel, s: ChannelInternals): void {
  internals.set(channel, s);
}

/** @internal — removes state (old channel after rotate). */
export function dropInternals(channel: Channel): void {
  internals.delete(channel);
}
