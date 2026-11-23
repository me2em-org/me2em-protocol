// packages/pact/src/assemble/evict.ts — EVICT — the target does not sign (D26′) (PACTS §7.5).

import { buildEvent } from './common.js';
import type { Clock, Event } from '../types.js';

export interface EvictInput {
  /** pactPub of the removed ACTIVE member. */
  tp: string;
  /** Reason (optional, ≤ 256 chars). */
  rs?: string;
}

/** Assembles EVICT — the target does not sign (D26′) against the verified prefix `events`. */
export function assembleEvict(events: Event[], input: EvictInput, signerKeys: Uint8Array[], clock?: Clock): Event {
  return buildEvent(events, 'EVICT', {
    tp: input.tp,
    ...(input.rs !== undefined ? { rs: input.rs } : {}),
  }, signerKeys, clock);
}
